import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { babelParse, parse } from '@vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8'))
const source = descriptor.scriptSetup.content
const names = new Set([
  'firstPositiveCount', 'maxAvailableCount', 'loadedSourceCountFor',
  'sourceOverviewStats', 'sourceListCountText', 'normalizeSourceListResponse',
  'sourceRequestType', 'mergeLocalFallback', 'loadSourceListPage',
])
const code = babelParse(source, { sourceType: 'module' }).program.body
  .filter((node) => names.has(node.id?.name || node.declarations?.[0]?.id?.name))
  .map((node) => source.slice(node.start, node.end)).join('\n')

function harness({ total = 0, count = 0, apiRows = [], fallbackRows = [], type = 'tool_search', hasMore = false } = {}) {
  const ref = (value) => ({ value })
  const state = {
    props: { job: { jobId: 'test' }, databaseSources: {}, phase: 'done' },
    activeSourceType: ref(type),
    sourceListItems: ref([]),
    sourceListSummary: ref(null),
    sourceListDiagnostics: ref(null),
    sourceListTotal: ref(null),
    sourceListLoading: ref(false),
    sourceListError: ref(''),
    sourceListNotice: ref(''),
    sourceListPage: ref(1),
    sourceCurrentPage: ref(1),
    sourceListPageSize: ref(10),
    sourceListHasMore: ref(false),
    normalizedSources: ref([]),
    reportCitationNumbers: ref([]),
  }
  const bindings = {
    ...state,
    computed: (get) => ({ get value() { return get() } }),
    fetchReportSources: async () => ({
      total, items: apiRows, hasMore,
      meta: { summary: { databaseRecallCount: 0, toolSearchCount: count } },
    }),
    sourceRefreshController: {
      runRequest: async ({ request }) => ({ kind: 'success', value: await request() }),
    },
    normalizeSourceListItem: (item, index, group) => ({ ...item, sourceGroup: item.sourceGroup || group }),
    localSourcePool: (group) => group === 'database_recall' ? [] : fallbackRows,
    sourceCandidateHitTotal: () => 200,
    candidateDetailNotice: () => '',
  }
  return {
    ...state,
    ...new Function(...Object.keys(bindings), `
      let sourceListRequestId = 0;
      ${code}
      return { maxAvailableCount, sourceOverviewStats, sourceListCountText, loadSourceListPage };
    `)(...Object.values(bindings)),
  }
}

const rows = (length) => Array.from({ length }, (_, id) => ({ id, sourceGroup: 'tool_search' }))

test('empty API results with reference fallback use the displayed row count', async () => {
  const s = harness({ fallbackRows: rows(34) })
  await s.loadSourceListPage()
  assert.equal(s.sourceListItems.value.length, 34)
  assert.equal(s.sourceListTotal.value, 34)
  assert.equal(s.sourceListCountText.value, '共 34 条信源')
  assert.equal(s.sourceOverviewStats.value.toolSearch, 34)
  assert.equal(s.sourceOverviewStats.value.databaseRecall, 0)
  assert.equal(s.sourceListHasMore.value, false)
})

test('fallback overview count stays consistent when selecting other source groups', async () => {
  const s = harness({ fallbackRows: rows(34) })
  await s.loadSourceListPage()
  for (const type of ['all', 'database_recall', 'report_refs', 'candidate_hits']) {
    s.activeSourceType.value = type
    s.sourceListTotal.value = null
    s.sourceListItems.value = []
    assert.equal(s.sourceOverviewStats.value.toolSearch, 34)
  }
})

test('positive paginated API totals are not replaced by page size or reference count', async () => {
  const s = harness({ total: 100, count: 100, apiRows: rows(10), fallbackRows: rows(140), hasMore: true })
  await s.loadSourceListPage()
  assert.equal(s.sourceListTotal.value, 100)
  assert.equal(s.sourceOverviewStats.value.toolSearch, 100)
  assert.equal(s.sourceListItems.value.length, 10)
  assert.equal(s.sourceListHasMore.value, true)
})

test('API rows are a lower bound even when the API total is zero', async () => {
  const s = harness({ apiRows: rows(3) })
  await s.loadSourceListPage()
  assert.equal(s.sourceListTotal.value, 3)
  assert.equal(s.sourceOverviewStats.value.toolSearch, 3)
})

test('actually empty results still show zero', async () => {
  const s = harness()
  await s.loadSourceListPage()
  assert.equal(s.sourceListCountText.value, '共 0 条信源')
  assert.equal(s.sourceOverviewStats.value.toolSearch, 0)
})

test('unknown counts stay unknown while loading, and null never masks a valid count', () => {
  const s = harness()
  s.sourceListLoading.value = true
  assert.equal(s.maxAvailableCount(undefined, null, '', -1, NaN), null)
  assert.equal(s.maxAvailableCount(null, '34', 0), 34)
  assert.equal(s.sourceOverviewStats.value.toolSearch, null)
})

test('candidate-pool totals remain separate from visible candidate details', async () => {
  const s = harness({ total: 200, type: 'candidate_hits' })
  await s.loadSourceListPage()
  assert.equal(s.sourceListTotal.value, 200)
  assert.equal(s.sourceListItems.value.length, 0)
})
