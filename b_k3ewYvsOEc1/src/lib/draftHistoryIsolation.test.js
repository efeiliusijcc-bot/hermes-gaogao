import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { babelParse, compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as flow from './draftAssistantFlow.js'
import * as autosave from './draftAutosave.js'
import * as planning from './eventTaskPlan.js'
import * as analysisStore from './draftAnalysisStore.js'

const source = readFileSync(new URL('../components/DraftAssistant.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'draft-history-test', genDefaultAs: 'component' })
const imports = babelParse(script.content, { sourceType: 'module' }).program.body
  .filter((node) => node.type === 'ImportDeclaration')
let setupCode = script.content
for (const node of [...imports].reverse()) {
  setupCode = setupCode.slice(0, node.start) + setupCode.slice(node.end)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
const outline = (id) => ({
  outlineId: `outline-${id}`,
  eventId: id,
  outline: {
    reportTitle: `Title ${id}`,
    outlineItems: [{ title: 'Section', summary: 'Facts', children: [] }],
  },
})
const event = (id, withOutline = false) => ({
  event: { eventId: id, title: id, rawInput: { materials: `Materials ${id}` } },
  analysis: { oneSentenceSummary: `Summary ${id}` },
  latestOutline: withOutline ? outline(id) : null,
})

function mountLogic(t, overrides = {}, initialProps = {}) {
  const scope = vue.effectScope()
  const unmounts = []
  const mounts = []
  const emissions = []
  const api = {
    getDraftEvents: async () => ({ items: [] }),
    getDraftEvent: async (id) => event(id),
    ...overrides,
  }
  const modules = {
    vue: { ...vue, onMounted: (fn) => mounts.push(fn), onBeforeUnmount: (fn) => unmounts.push(fn) },
    '../lib/api.js': api,
    '../lib/draftAssistantFlow.js': flow,
    '../lib/draftAutosave.js': autosave,
    '../lib/eventTaskPlan.js': planning,
    '../lib/draftAnalysisStore.js': analysisStore,
  }
  const bindings = { window: { addEventListener() {}, removeEventListener() {} } }
  for (const node of imports) {
    const module = modules[node.source.value]
    for (const spec of node.specifiers) {
      bindings[spec.local.name] = module
        ? (module[spec.imported?.name || 'default'] || (() => { throw new Error(`Unexpected call: ${spec.local.name}`) }))
        : {}
    }
  }
  const component = new Function(...Object.keys(bindings), `${setupCode}\nreturn component;`)(...Object.values(bindings))
  const props = vue.reactive({ currentUser: { id: 'test-user' }, initialEventId: '', ...initialProps })
  const state = scope.run(() => component.setup(
    props,
    { expose() {}, emit: (...args) => emissions.push(args) },
  ))
  const unmount = () => { unmounts.forEach((fn) => fn()); scope.stop() }
  t.after(unmount)
  return { state, emissions, unmount, props, mount: async () => { for (const fn of mounts) await fn() } }
}

function backgroundJobStore() {
  const state = vue.reactive({
    jobs: { A: { jobId: 'job-A', eventId: 'A', status: 'running' } }, readJobs: [],
  })
  return {
    state,
    jobForEvent: id => state.jobs[id] || null,
    activeJob: () => Object.values(state.jobs).find(analysisStore.isActiveAnalysis),
    selectEvent() {},
  }
}

test('successful job keeps loading until its analysis detail arrives and blocks outline generation', async t => {
  const result = deferred()
  const store = backgroundJobStore()
  let reads = 0, outlines = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: async () => ++reads === 1
      ? { event: { eventId: 'A', analysis: {} }, analysisJob: { ...store.state.jobs.A } }
      : result.promise,
    generateDraftOutline: async () => { outlines++; return outline('A') },
  }, { analysisStore: store })
  await s.openEvent('A')
  store.state.jobs.A.status = 'succeeded'
  await vue.nextTick()
  assert.equal(s.analysisLoading.value, true)
  await s.createOutline()
  assert.equal(outlines, 0)
  result.resolve({ ...event('A'), analysisJob: { ...store.state.jobs.A } })
  await settle()
  assert.equal(s.analysisLoading.value, false)
  assert.equal(s.analysisSections.value[0].content, 'Summary A')
  assert.equal(reads, 2)
  await s.createOutline()
  assert.equal(outlines, 1)
})

test('failure to fetch completed analysis shows an error instead of empty result sections', async t => {
  const result = deferred()
  const store = backgroundJobStore()
  let reads = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: async () => ++reads === 1 ? { event: { eventId: 'A', analysis: {} } } : result.promise,
  }, { analysisStore: store })
  await s.openEvent('A')
  store.state.jobs.A.status = 'succeeded'
  await vue.nextTick()
  assert.equal(s.analysisLoading.value, true)
  result.reject(new Error('Detail request failed'))
  await settle()
  assert.equal(s.analysisLoading.value, false)
  assert.match(s.displayedAnalysisError.value, /结果暂时无法加载/)
})

for (const reject of [false, true]) {
  test(`late completed-analysis ${reject ? 'error' : 'result'} cannot affect another history`, async t => {
    const result = deferred()
    const store = backgroundJobStore()
    let reads = 0
    const { state: s } = mountLogic(t, {
      getDraftEvent: async id => id !== 'A' ? event(id) : ++reads === 1
        ? { event: { eventId: 'A', analysis: {} } } : result.promise,
    }, { analysisStore: store })
    await s.openEvent('A')
    store.state.jobs.A.status = 'succeeded'
    await vue.nextTick()
    await s.openEvent('B')
    assert.equal(s.analysisLoading.value, false)
    if (reject) result.reject(new Error('A detail failed'))
    else result.resolve(event('A'))
    await settle()
    assert.equal(s.currentEventId.value, 'B')
    assert.equal(s.analysisLoading.value, false)
    assert.equal(s.analysisSections.value[0].content, 'Summary B')
    assert.equal(s.displayedAnalysisError.value, '')
  })
}

test('completion during a history read fetches the finished result after the stale history response', async t => {
  const history = deferred(), result = deferred()
  const store = backgroundJobStore()
  let reads = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: () => ++reads === 1 ? history.promise : result.promise,
  }, { analysisStore: store })
  const opening = s.openEvent('A')
  await settle()
  store.state.jobs.A.status = 'succeeded'
  await vue.nextTick()
  history.resolve({ event: { eventId: 'A', analysis: {} }, analysisJob: { jobId: 'job-A', eventId: 'A', status: 'running' } })
  await opening
  await vue.nextTick()
  assert.equal(s.analysisLoading.value, true)
  assert.equal(reads, 2)
  result.resolve({ ...event('A'), analysisJob: { ...store.state.jobs.A } })
  await settle()
  assert.equal(s.analysisLoading.value, false)
  assert.equal(s.analysisSections.value[0].content, 'Summary A')
})

test('opening an already completed history uses its loaded detail without a second request', async t => {
  const store = backgroundJobStore()
  store.state.jobs.A.status = 'succeeded'
  let reads = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: async () => { reads++; return { ...event('A'), analysisJob: { ...store.state.jobs.A } } },
  }, { analysisStore: store })
  await s.openEvent('A')
  await settle()
  assert.equal(reads, 1)
  assert.equal(s.analysisLoading.value, false)
  assert.equal(s.analysisSections.value[0].content, 'Summary A')
})

test('a new attempt invalidates the prior attempt detail without clearing the new loading state', async t => {
  const result = deferred()
  const store = backgroundJobStore()
  let reads = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: async () => ++reads === 1 ? { event: { eventId: 'A', analysis: {} } } : result.promise,
  }, { analysisStore: store })
  await s.openEvent('A')
  store.state.jobs.A.status = 'succeeded'
  await vue.nextTick()
  store.state.jobs.A = { jobId: 'retry-A', eventId: 'A', status: 'running' }
  await vue.nextTick()
  result.resolve(event('stale-A'))
  await settle()
  assert.equal(s.eventResult.value.event.eventId, 'A')
  assert.equal(s.isLoadingAnalysisResult.value, false)
  assert.equal(s.analysisLoading.value, true)
})

test('daily import only prefills the composer until the user starts drafting', async (t) => {
  let analyzeCalls = 0
  const { state: s, mount } = mountLogic(t, {
    getDraftEvent: async () => ({
      event: { eventId: 'daily', title: 'Daily title', summary: 'Daily summary', rawInput: { source: 'daily_awareness' } },
      analysis: { oneSentenceSummary: 'Previously saved analysis' },
      latestOutline: outline('daily'),
    }),
    analyzeDraftEvent: async (payload) => {
      analyzeCalls++
      assert.ok(JSON.stringify(payload).includes('Edited material'))
      return event('generated')
    },
  }, { initialEventId: 'daily' })
  await mount()
  assert.equal(s.stage.value, 'input')
  assert.equal(s.sourceInput.value, 'Daily title\n\nDaily summary')
  assert.equal(s.eventResult.value, null)
  assert.equal(s.selectedOutline.value, null)
  assert.equal(analyzeCalls, 0)
  s.sourceInput.value += '\nEdited material'
  await s.startDraft()
  assert.equal(analyzeCalls, 1)
  assert.equal(s.stage.value, 'analysis')
})

test('a new imported event prefills an already mounted assistant without restoring analysis', async (t) => {
  const { state: s, props } = mountLogic(t)
  await s.openEvent('history')
  assert.equal(s.stage.value, 'analysis')
  props.initialEventId = 'daily'
  await vue.nextTick()
  await settle()
  assert.equal(s.stage.value, 'input')
  assert.equal(s.sourceInput.value, 'Materials daily')
  assert.equal(s.eventResult.value, null)
})

test('history selection clears another draft loading state and ignores its late analysis', async (t) => {
  const analysis = deferred()
  const { state: s } = mountLogic(t, { analyzeDraftEvent: () => analysis.promise })
  s.sourceInput.value = 'Draft A'
  const pending = s.startDraft()
  assert.equal(s.isAnalyzing.value, true)
  await s.openEvent('B')
  assert.equal(s.isAnalyzing.value, false)
  assert.equal(s.currentEventId.value, 'B')
  analysis.resolve(event('A'))
  await pending
  assert.equal(s.currentEventId.value, 'B')
  assert.equal(s.sourceInput.value, 'Materials B')
  assert.equal(s.analysisSections.value[0].content, 'Summary B')
})

test('late analysis failures do not appear on another history record', async (t) => {
  const analysis = deferred()
  const { state: s } = mountLogic(t, { analyzeDraftEvent: () => analysis.promise })
  s.sourceInput.value = 'Draft A'
  const pending = s.startDraft()
  await s.openEvent('B')
  analysis.reject(new Error('A request failed'))
  await pending
  assert.equal(s.analysisError.value, '')
  assert.equal(s.pageError.value, '')
})

test('late analysis completion cannot stop a newer analysis spinner', async (t) => {
  const a = deferred(), b = deferred()
  let call = 0
  const { state: s } = mountLogic(t, { analyzeDraftEvent: () => (++call === 1 ? a.promise : b.promise) })
  s.sourceInput.value = 'Draft A'
  const first = s.startDraft()
  await s.startNewEvent()
  s.sourceInput.value = 'Draft B'
  const second = s.startDraft()
  a.resolve(event('A'))
  await first
  assert.equal(s.isAnalyzing.value, true)
  assert.equal(s.currentEventId.value, '')
  b.resolve(event('B'))
  await second
  assert.equal(s.isAnalyzing.value, false)
  assert.equal(s.currentEventId.value, 'B')
})

test('rapid history clicks apply only the last selection even when responses arrive out of order', async (t) => {
  const b = deferred(), c = deferred()
  const { state: s } = mountLogic(t, { getDraftEvent: (id) => id === 'B' ? b.promise : c.promise })
  const first = s.openEvent('B')
  await settle()
  const second = s.openEvent('C')
  await settle()
  c.resolve(event('C'))
  await second
  b.resolve(event('B'))
  await first
  assert.equal(s.currentEventId.value, 'C')
})

test('new draft invalidates pending history reads', async (t) => {
  const history = deferred()
  const { state: s } = mountLogic(t, { getDraftEvent: () => history.promise })
  const pending = s.openEvent('A')
  await settle()
  await s.startNewEvent()
  history.resolve(event('A', true))
  await pending
  assert.equal(s.stage.value, 'input')
  assert.equal(s.currentEventId.value, '')
})

test('outline generation stays isolated across history switches and newer requests', async (t) => {
  const a = deferred(), b = deferred()
  const { state: s } = mountLogic(t, { generateDraftOutline: ({ eventId }) => eventId === 'A' ? a.promise : b.promise })
  await s.openEvent('A')
  const first = s.createOutline()
  await s.openEvent('B')
  assert.equal(s.isGeneratingOutline.value, false)
  const second = s.createOutline()
  a.resolve(outline('A'))
  await first
  assert.equal(s.isGeneratingOutline.value, true)
  assert.equal(s.selectedOutline.value, null)
  b.resolve(outline('B'))
  await second
  assert.equal(s.selectedOutline.value.outlineId, 'outline-B')
  assert.equal(s.isGeneratingOutline.value, false)
})

test('late outline revision does not replace the opened history outline', async (t) => {
  const revision = deferred()
  const { state: s } = mountLogic(t, {
    getDraftEvent: async (id) => event(id, true),
    refineDraftOutline: () => revision.promise,
  })
  await s.openEvent('A')
  s.revisionFeedback.value = 'Revise A'
  const pending = s.reviseOutline()
  await settle()
  await s.openEvent('B')
  assert.equal(s.isRevising.value, false)
  revision.resolve(outline('A'))
  await pending
  assert.equal(s.selectedOutline.value.outlineId, 'outline-B')
})

test('history navigation still waits for the original outline autosave', async (t) => {
  const save = deferred()
  let savedId
  const { state: s } = mountLogic(t, {
    getDraftEvent: async (id) => event(id, true),
    manualUpdateDraftOutline: ({ outlineId }) => { savedId = outlineId; return save.promise },
  })
  await s.openEvent('A')
  await settle()
  s.outlineDraft.value.reportTitle = 'Edited A'
  const switching = s.openEvent('B')
  await settle()
  assert.equal(savedId, 'outline-A')
  assert.equal(s.currentEventId.value, 'A')
  save.resolve(outline('A'))
  await switching
  assert.equal(s.currentEventId.value, 'B')
  assert.equal(s.outlineDraft.value.reportTitle, 'Title B')
})

test('unmounted draft ignores pending analysis responses', async (t) => {
  const analysis = deferred()
  const { state: s, unmount } = mountLogic(t, { analyzeDraftEvent: () => analysis.promise })
  s.sourceInput.value = 'Draft A'
  const pending = s.startDraft()
  unmount()
  analysis.resolve(event('A'))
  await pending
  assert.equal(s.eventResult.value, null)
})

test('outline generation preserves the existing API snapshot without requiring task editing', async (t) => {
  const result = event('A')
  result.analysis.intentRecognition = { detected: 'uncertain', resolved: null, reason: 'Incomplete model response', source: 'fallback' }
  result.analysis.eventTaskPlan = {
    version: 1,
    tasks: planning.EVENT_TASK_DEFINITIONS.map((task) => ({ ...task, objective: task.title, searchQueries: ['Query'], enabled: true })),
  }
  let submitted
  const { state: s } = mountLogic(t, {
    getDraftEvent: async () => result,
    generateDraftOutline: async (input) => { submitted = input; return outline('A') },
  })
  await s.openEvent('A')
  await s.createOutline()
  assert.equal(submitted.intentRecognition.resolved, 'event_timeline')
  assert.equal(submitted.intentRecognition.detected, 'uncertain')
  assert.equal(submitted.intentRecognition.source, 'fallback')
  assert.equal(submitted.eventTaskPlan.tasks.length, 5)
  assert.equal(s.stage.value, 'outline')
  assert.equal(s.pageError.value, '')
})

test('explicit ordinary intent and historical choices remain unchanged', () => {
  assert.equal(flow.resolveDraftIntentRecognition({ detected: 'other', source: 'model' }).resolved, 'other')
  assert.equal(flow.resolveDraftIntentRecognition({ detected: 'uncertain', resolved: 'other' }).resolved, 'other')
  const view = readFileSync(new URL('../components/DraftAnalysisView.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(view, /EventTaskPlanEditor|draft-event-planning|五维|planningError|@resolve-intent/)
  assert.doesNotMatch(source, /updateDraftEventTask|draftEventPlanningError/)
})

test('five-dimensional task editing remains in the AI report planning module only', () => {
  const canvas = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')
  assert.match(canvas, /<EventTaskPlanEditor/)
  assert.match(canvas, /@update-task=/)
  const view = readFileSync(new URL('../components/DraftAnalysisView.vue', import.meta.url), 'utf8')
  assert.match(view, /v-for="section in sections"/)
  assert.match(view, /loading \|\| generating \|\| Boolean\(error\)/)
  assert.match(view, /emit\('generate'\)/)
})

test('older analysis without a task snapshot can still generate an outline', async (t) => {
  let submitted
  const { state: s } = mountLogic(t, {
    generateDraftOutline: async (input) => { submitted = input; return outline('A') },
  })
  await s.openEvent('A')
  await s.createOutline()
  assert.deepEqual(submitted, { eventId: 'A', outlinePreference: '' })
  assert.equal(s.stage.value, 'outline')
})

test('accepted background analysis cannot replace B after navigating during submission', async t => {
  const pending = deferred()
  const store = analysisStore.createDraftAnalysisStore({
    api: { list: async () => ({ items: [] }), submit: () => pending.promise },
    local: null, session: null, schedule: () => 1, unschedule() {}, uuid: () => 'request-A',
  })
  t.after(() => store.dispose())
  store.setAccount('test-user')
  await settle()
  const { state: s } = mountLogic(t, {}, { analysisStore: store })
  s.sourceInput.value = '事件 A 的材料，供受控后台分析'
  const start = s.startDraft()
  await s.openEvent('B')
  pending.resolve({ jobId: 'A', eventId: 'A', status: 'running', createdAt: new Date().toISOString() })
  await start
  assert.equal(s.currentEventId.value, 'B')
  assert.equal(s.analysisLoading.value, false)
  assert.equal(s.eventResult.value.event.eventId, 'B')
  assert.equal(store.activeJob().eventId, 'A')
})

test('failed or queued new histories block outline; old completed outline remains usable', async t => {
  let outlines = 0
  const { state: s } = mountLogic(t, {
    getDraftEvent: async id => ({ ...event(id, id === 'old'), analysisJob: id === 'old' ? null : { jobId: id, status: id } }),
    generateDraftOutline: async () => { outlines++; return outline('queued') },
  })
  await s.openEvent('queued')
  assert.equal(s.analysisLoading.value, true)
  await s.createOutline()
  await s.openEvent('failed')
  await s.createOutline()
  assert.equal(outlines, 0)
  assert.match(s.displayedAnalysisError.value, /失败/)
  await s.openEvent('old')
  assert.equal(s.stage.value, 'outline')
  assert.equal(s.selectedOutline.value.outlineId, 'outline-old')
})
