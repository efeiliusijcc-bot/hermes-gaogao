import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { babelParse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as drafts from './reportPlanningDraft.js'
import * as workspace from './reportWorkspaceState.js'
import * as context from './reportPlanningContext.js'
import * as logs from './reportExecutionLogs.js'
import * as eventPlan from './eventTaskPlan.js'

const form = {
  title: 'Original topic', reportType: 'write-hb-k', contextText: 'Original materials',
  parameterValues: { '关注方向': 'Original focus' }, activeParameters: ['关注方向'],
  countryOrRegion: '', currentPosition: '', scenario: 'foreign_leader_visit',
  targetCity: '', visitTime: '', outputDepth: 'detailed',
}
const plan = (title = 'Original plan') => ({
  title, summary: 'Summary', searchQueries: ['query'],
  steps: [{ id: 'section', options: [{ id: 'option', label: 'Direction', selected: true }] }],
})
function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function controller(t, store = storage()) {
  const state = drafts.createReportPlanningDraft({ storage: () => store, delay: 5 })
  t.after(state.dispose)
  state.setAccount('alice')
  return { state, store }
}

test('session refresh restores every editor field without opening the modal', (t) => {
  const { state: s, store } = controller(t)
  s.start(form)
  s.draft.value.editor = {
    ...drafts.emptyPlanningEditor(), reportPlan: { ...plan(), steps: [...plan().steps, { id: 'second', options: [] }] }, planStepIndex: 1,
    planSelections: { section: ['option', 'custom'] }, planSearchSelections: ['query'],
    planSourceInput: 'https://example.com', planSupplement: 'Supplement',
    manualSourceDraft: 'unfinished source', manualDirectionDraft: 'unfinished direction',
  }
  s.draft.value.status = 'ready'
  s.suspend()
  const { state: restored } = controller(t, store)
  assert.deepEqual(restored.draft.value, s.draft.value)
  assert.equal(restored.visible.value, false)
})

test('refresh interrupts generation and marks in-flight submission uncertain', (t) => {
  const { state: s, store } = controller(t)
  s.start(form)
  assert.equal(controller(t, store).state.draft.value.status, 'interrupted')
  s.draft.value.editor.reportPlan = plan()
  s.begin('submitting')
  assert.equal(controller(t, store).state.draft.value.status, 'uncertain')
})

test('corrupt, obsolete and structurally invalid caches are ignored', (t) => {
  const { state: s } = controller(t)
  s.start(form)
  const valid = JSON.parse(JSON.stringify(s.draft.value))
  for (const raw of ['{', JSON.stringify({ ...valid, version: 99 }),
    JSON.stringify({ ...valid, form: {} }),
    JSON.stringify({ ...valid, editor: { ...valid.editor, planSelections: { x: 1 } } })]) {
    const store = storage()
    store.setItem('hermes-report-planning:alice', raw)
    assert.equal(controller(t, store).state.draft.value, null)
  }
})

test('storage exceptions retain memory and show an explicit warning', (t) => {
  const { state: s } = controller(t, { getItem() { throw Error('blocked') }, setItem() { throw Error('quota') } })
  s.start(form)
  s.suspend()
  assert.equal(s.draft.value.form.title, form.title)
  assert.equal(s.storageWarning.value, '当前仅临时保存，刷新可能丢失')
})

test('account changes remove old cache and invalidate requests', (t) => {
  const { state: s, store } = controller(t)
  const token = s.start(form)
  s.setAccount('bob')
  assert.equal(store.getItem('hermes-report-planning:alice'), null)
  assert.equal(s.draft.value, null)
  assert.equal(s.matches(token), false)
  s.start({ ...form, title: 'Bob' })
  s.setAccount('')
  assert.equal(store.getItem('hermes-report-planning:bob'), null)
})

test('a refreshed tab authenticated as a different account removes the prior owner draft', (t) => {
  const { state: alice, store } = controller(t)
  alice.start(form)
  const bob = drafts.createReportPlanningDraft({ storage: () => store })
  t.after(bob.dispose)
  bob.setAccount('bob')
  assert.equal(bob.draft.value, null)
  assert.equal(store.getItem('hermes-report-planning:alice'), null)
  alice.discard()
})

test('submission timeout is uncertain and does not retry the request', async () => {
  const request = deferred()
  await assert.rejects(drafts.awaitPlanningSubmission(request.promise, 5), /提交结果待核实/)
  request.resolve({ jobId: 'late' })
})

const source = readFileSync(new URL('../composables/useReportJobs.js', import.meta.url), 'utf8')
const imports = babelParse(source, { sourceType: 'module' }).program.body.filter((node) => node.type === 'ImportDeclaration')
let code = source
for (const node of [...imports].reverse()) code = code.slice(0, node.start) + code.slice(node.end)
code = code.replace('export function useReportJobs', 'function useReportJobs')

function jobs(t, overrides = {}) {
  const store = storage()
  const unmounts = []
  const fakeWindow = {
    sessionStorage: store, confirm: () => true, addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
  }
  const previousWindow = globalThis.window
  globalThis.window = fakeWindow
  t.after(() => { globalThis.window = previousWindow })
  const api = {
    getAuthToken: () => 'test',
    fetchVectorSourceStatus: async () => ({ enabled: true, available: true, indexedRows: 1 }),
    createReportPlan: async () => plan(),
    fetchHermesHealth: async () => ({ status: 'ok' }),
    createReportJob: async () => ({ jobId: 'created', status: 'queued' }),
    fetchReportJob: async (jobId) => ({ jobId, status: 'succeeded' }),
    fetchReportResult: async () => ({ html: 'Report' }),
    fetchReportDatabaseSources: async () => ({}),
    fetchReportProgress: async () => null,
    fetchReportJobEventLog: async () => [],
    fetchReportJobs: async () => [],
    getJobEventsUrl: () => '/events',
    ...overrides,
  }
  const modules = {
    vue: { ...vue, onMounted() {}, onUnmounted: (fn) => unmounts.push(fn) },
    '../lib/api.js': api, '../lib/reportPlanningDraft.js': drafts,
    '../lib/reportWorkspaceState.js': workspace, '../lib/reportPlanningContext.js': context,
    '../lib/reportExecutionLogs.js': logs, '../lib/eventTaskPlan.js': eventPlan,
    '../lib/reportHistoryCutoff.js': { REPORT_HISTORY_CREATED_AFTER: '' },
  }
  const bindings = {
    window: fakeWindow, localStorage: store,
    EventSource: class { addEventListener() {} close() {} },
  }
  for (const node of imports) for (const spec of node.specifiers) {
    bindings[spec.local.name] = modules[node.source.value][spec.imported.name] ||
      (() => { throw Error(`Unexpected ${spec.local.name}`) })
  }
  const scope = vue.effectScope()
  const s = scope.run(() => new Function(...Object.keys(bindings), `${code}\nreturn useReportJobs();`)(...Object.values(bindings)))
  t.after(() => { unmounts.forEach((fn) => fn()); scope.stop() })
  s.setPlanningAccount('alice')
  for (const [key, value] of Object.entries(form)) s[key].value = structuredClone(value)
  return s
}

test('leaving for each workspace hides but does not cancel a pending plan', async (t) => {
  for (const page of ['history', 'qa', 'daily', 'draft']) {
    const response = deferred()
    const s = jobs(t, { createReportPlan: () => response.promise })
    const run = s.handleGenerate()
    await settle()
    if (page === 'history') await s.loadJobList(true)
    else s.backgroundActiveWorkspace()
    response.resolve(plan(page))
    await run
    assert.equal(s.planningVisible.value, false, page)
    assert.equal(s.planningDraft.value.status, 'ready', page)
    assert.equal(s.reportPlan.value.title, page)
  }
})

test('history titles do not replace original inputs, step or custom choices', async (t) => {
  const s = jobs(t)
  await s.handleGenerate()
  s.nextPlanStep()
  s.addPlanOption(s.reportPlan.value.steps[0].id, { label: 'Custom direction' })
  s.planSupplement.value = 'Keep this'
  const selections = structuredClone(JSON.parse(JSON.stringify(s.planSelections.value)))
  await s.monitorJobFromList({ jobId: 'history', status: 'succeeded', skill: 'write-hb', payload: { topic: 'History title' } })
  assert.equal(s.title.value, 'History title')
  s.resumePlanning()
  assert.equal(s.title.value, form.title)
  assert.equal(s.contextText.value, form.contextText)
  assert.equal(s.planStepIndex.value, 1)
  assert.deepEqual(s.planSelections.value, selections)
  assert.equal(s.planSupplement.value, 'Keep this')
})

test('old success, failure and finalizers cannot overwrite a replacement or account', async (t) => {
  for (const ending of ['success', 'error', 'account']) {
    const old = deferred()
    let calls = 0
    const s = jobs(t, { createReportPlan: () => ++calls === 1 ? old.promise : Promise.resolve(plan('New plan')) })
    const run = s.handleGenerate()
    await settle()
    if (ending === 'account') s.setPlanningAccount('bob')
    else s.discardPlanning()
    await s.handleGenerate()
    if (ending === 'error') old.reject(Error('Old failure'))
    else old.resolve(plan('Old plan'))
    await run
    assert.equal(s.reportPlan.value.title, 'New plan')
    assert.equal(s.planError.value, '')
    assert.equal(s.isPlanning.value, false)
  }
})

test('new/import conflict preserves state on dismiss and executes only after replacement', async (t) => {
  const s = jobs(t)
  await s.handleGenerate()
  const id = s.planningDraft.value.id
  let imports = 0
  s.requestNewPlanning(() => imports++)
  s.resolvePlanningConflict('cancel')
  assert.equal(imports, 0)
  assert.equal(s.planningDraft.value.id, id)
  s.requestNewPlanning(() => imports++)
  s.resolvePlanningConflict('continue')
  assert.equal(s.planningVisible.value, true)
  assert.equal(imports, 0)
  s.requestNewPlanning(() => imports++)
  s.resolvePlanningConflict('replace')
  assert.equal(imports, 1)
  assert.equal(s.planningDraft.value, null)
})

test('discard requires confirmation, and uncertain submission requires a separate confirmed retry', async (t) => {
  let calls = 0
  const s = jobs(t, { createReportJob: async () => { calls++; throw Error('Network error') } })
  await s.handleGenerate()
  globalThis.window.confirm = () => false
  assert.equal(s.discardPlanning(), false)
  assert.ok(s.planningDraft.value)
  await s.confirmReportPlan()
  await s.retryPlanningSubmission()
  assert.equal(calls, 1)
  globalThis.window.confirm = () => true
  await s.retryPlanningSubmission()
  assert.equal(calls, 2)
  assert.equal(s.discardPlanning(), true)
  assert.equal(s.planningDraft.value, null)
})

test('submit uses the original draft, submits once and finishes in background without navigation', async (t) => {
  const response = deferred()
  const health = deferred()
  const payloads = []
  const s = jobs(t, {
    fetchHermesHealth: () => health.promise,
    createReportJob: (payload) => { payloads.push(payload); return response.promise },
  })
  await s.handleGenerate()
  const run = s.confirmReportPlan()
  await s.confirmReportPlan()
  await s.loadJobList(true)
  s.title.value = 'Wrong history title'
  s.contextText.value = 'Wrong history materials'
  health.resolve({ status: 'ok' })
  await settle()
  assert.equal(payloads.length, 1)
  assert.ok(JSON.stringify(payloads[0]).includes(form.title))
  assert.ok(JSON.stringify(payloads[0]).includes(form.contextText))
  assert.ok(!JSON.stringify(payloads[0]).includes('Wrong history'))
  response.resolve({ jobId: 'new-background', status: 'queued' })
  await run
  assert.equal(s.planningDraft.value, null)
  assert.equal(s.currentView.value, 'list')
  assert.ok(s.recentJobs.value.some((job) => job.jobId === 'new-background'))
  assert.equal(s.getJobTitle(s.recentJobs.value.find((job) => job.jobId === 'new-background')), form.title)
})

test('rejected submission retains choices; ambiguous submission blocks automatic retry', async (t) => {
  for (const status of [400, 503, undefined]) {
    let calls = 0
    const s = jobs(t, { createReportJob: async () => { calls++; throw Object.assign(Error('Rejected'), { status }) } })
    await s.handleGenerate()
    s.planSupplement.value = 'Retained'
    await s.confirmReportPlan()
    assert.equal(s.planningDraft.value.status, status === 400 ? 'ready' : 'uncertain')
    assert.equal(s.planSupplement.value, 'Retained')
    if (status !== 400) {
      await s.confirmReportPlan()
      assert.equal(calls, 1)
    }
  }
})

test('late creation after logout cannot update the new account', async (t) => {
  const response = deferred()
  const s = jobs(t, { createReportJob: () => response.promise })
  await s.handleGenerate()
  const run = s.confirmReportPlan()
  await settle()
  s.setPlanningAccount('bob')
  await s.handleGenerate()
  response.resolve({ jobId: 'alice-job', status: 'queued' })
  await run
  assert.equal(s.planningDraft.value.accountId, 'bob')
  assert.ok(!s.recentJobs.value.some((job) => job.jobId === 'alice-job'))
})

test('logging back into the same account does not revive a previous submission lease', async (t) => {
  const response = deferred()
  const s = jobs(t, { createReportJob: () => response.promise })
  await s.handleGenerate()
  const run = s.confirmReportPlan()
  await settle()
  s.setPlanningAccount('')
  s.setPlanningAccount('alice')
  await s.handleGenerate()
  response.resolve({ jobId: 'old-session', status: 'queued' })
  await run
  assert.equal(s.planningDraft.value.status, 'ready')
  assert.ok(!s.recentJobs.value.some((job) => job.jobId === 'old-session'))
})

test('a missing job id retains the draft as uncertain', async (t) => {
  const s = jobs(t, { createReportJob: async () => ({ status: 'queued' }) })
  await s.handleGenerate()
  await s.confirmReportPlan()
  assert.equal(s.planningDraft.value.status, 'uncertain')
})

test('foreground creation clears the draft and retains the existing active workspace', async (t) => {
  const result = deferred()
  const s = jobs(t, { fetchReportJob: () => result.promise })
  await s.handleGenerate()
  const run = s.confirmReportPlan()
  await settle()
  assert.equal(s.planningDraft.value, null)
  assert.equal(s.job.value.jobId, 'created')
  assert.equal(s.backgroundActiveWorkspace(), true)
  s.showGenerator()
  assert.equal(s.job.value.jobId, 'created')
  result.resolve({ jobId: 'created', status: 'succeeded' })
  await run
  assert.equal(s.phase.value, 'done')
})

test('a history read finishing after resume cannot change the restored draft form', async (t) => {
  const result = deferred()
  const s = jobs(t, { fetchReportResult: () => result.promise })
  await s.handleGenerate()
  const run = s.monitorJobFromList({ jobId: 'history', status: 'succeeded', payload: { topic: 'Late history' } })
  s.resumePlanning()
  result.resolve({ html: 'Late history' })
  await run
  assert.equal(s.title.value, form.title)
  assert.equal(s.phase.value, 'idle')
  assert.equal(s.planningVisible.value, true)
})

test('leaving or logging out while pre-submit health is pending cannot write late UI logs', async (t) => {
  const health = deferred()
  let submissions = 0
  const s = jobs(t, {
    fetchHermesHealth: () => health.promise,
    createReportJob: async () => { submissions++; return { jobId: 'unexpected' } },
  })
  await s.handleGenerate()
  const run = s.confirmReportPlan()
  s.setPlanningAccount('')
  s.resetForNewReport()
  const before = [...s.processLogs.value]
  health.resolve({ status: 'late-health' })
  await run
  assert.deepEqual(s.processLogs.value, before)
  assert.equal(submissions, 0)
})
