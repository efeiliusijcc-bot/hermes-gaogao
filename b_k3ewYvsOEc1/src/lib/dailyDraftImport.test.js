import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { babelParse, parse } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { createDraftAnalysisStore } from './draftAnalysisStore.js'
import { buildDraftAnalyzePayload } from './draftAssistantFlow.js'

function componentFunction(file, name, bindings) {
  const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  const source = descriptor.scriptSetup.content
  const node = babelParse(source, { sourceType: 'module' }).program.body
    .find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `${name} must exist in the real component`)
  return new Function(...Object.keys(bindings), `${source.slice(node.start, node.end)}; return ${name};`)(...Object.values(bindings))
}

function dailyImporter(emit, canImport = true) {
  return componentFunction('../components/DailyAwareness.vue', 'importToDraft', {
    canImportToDraft: ref(canImport), importingItemId: ref(''), importedEventIds: ref(new Set()),
    errorMessage: ref(''), noticeMessage: ref(''),
    importDailyEventToDraft() { assert.fail('Import must not create an intermediate history record') },
    emit,
  })
}

function handoff(store) {
  const refs = {
    draftInitialEventId: ref('stale-import'), draftOpenRequest: ref({ eventId: 'old-history' }),
    showDailyAwareness: ref(true), showUserManagement: ref(false),
    showPersonalSettings: ref(false), showDraftAssistant: ref(false),
  }
  const open = componentFunction('../App.vue', 'openDraftFromDaily', { ...refs, draftAnalysis: store })
  return { open, refs }
}

test('daily import only prefills; starting analysis creates one history with the edited materials', async t => {
  let historyCount = 0, submitted
  const store = createDraftAnalysisStore({
    api: {
      list: async () => ({ items: [] }),
      submit: async payload => {
        historyCount++
        submitted = payload
        return { jobId: 'job-one', eventId: 'event-one', status: 'running' }
      },
    }, local: null, session: null, schedule: () => 1, unschedule() {}, uuid: () => 'request-one',
  })
  t.after(() => store.dispose())
  store.setAccount('user-one')
  store.selectEvent('old-history')
  store.setComposer('previous composer')
  const { open, refs } = handoff(store)
  const runImport = dailyImporter((name, payload) => {
    assert.equal(name, 'open-draft-event')
    open(payload)
  })
  await runImport({ itemId: 'daily-one', title: 'Daily title', basicSituation: 'Daily material', backgroundContext: 'Other background' })
  assert.equal(historyCount, 0)
  assert.equal(store.state.composer, 'Daily title\n\nDaily material')
  assert.equal(store.state.selectedEventId, '')
  assert.equal(refs.draftInitialEventId.value, '')
  assert.equal(refs.draftOpenRequest.value, null)
  assert.equal(refs.showDraftAssistant.value, true)
  assert.equal(refs.showDailyAwareness.value, false)
  store.setComposer(store.state.composer + '\nEdited material')
  const payload = buildDraftAnalyzePayload(store.state.composer)
  await Promise.all([store.submit(payload), store.submit(payload)])
  assert.equal(historyCount, 1)
  assert.equal(submitted.materials, 'Daily title\n\nDaily material\nEdited material')
})

test('daily import preserves the original title and summary fallback without creating records', async () => {
  const payloads = []
  const runImport = dailyImporter((_name, payload) => payloads.push(payload))
  await runImport({ itemId: 'background-only', title: 'Title', backgroundContext: 'Background' })
  await runImport({ itemId: 'title-only', title: 'Title only' })
  assert.deepEqual(payloads, [{ materials: 'Title\n\nBackground' }, { materials: 'Title only' }])
})

test('daily import remains permission-gated and ignores missing item IDs', async () => {
  let emissions = 0
  await dailyImporter(() => emissions++, false)({ itemId: 'blocked', title: 'Title' })
  await dailyImporter(() => emissions++)({ title: 'No item ID' })
  assert.equal(emissions, 0)
})

test('importing while another analysis runs only changes the composer, not the active job', async t => {
  const store = createDraftAnalysisStore({ api: { list: async () => ({ items: [] }) }, local: null, session: null,
    schedule: () => 1, unschedule() {} })
  t.after(() => store.dispose())
  store.setAccount('user-one')
  store.state.jobs.A = { jobId: 'A', eventId: 'A', status: 'running' }
  const { open } = handoff(store)
  await dailyImporter((_name, payload) => open(payload))({ itemId: 'new-item', title: 'New material' })
  assert.equal(store.activeJob().eventId, 'A')
  assert.equal(store.state.composer, 'New material')
  assert.equal(await store.submit(buildDraftAnalyzePayload(store.state.composer)), null)
})

test('legacy event ID handoff remains supported', () => {
  const { open, refs } = handoff({ setComposer() { assert.fail('Legacy input must not overwrite the composer') } })
  open({ eventId: 'legacy-event' })
  assert.equal(refs.draftInitialEventId.value, 'legacy-event')
  assert.equal(refs.showDraftAssistant.value, true)
})
