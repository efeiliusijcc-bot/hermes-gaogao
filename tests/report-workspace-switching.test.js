import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stateUrl = new URL('../b_k3ewYvsOEc1/src/lib/reportWorkspaceState.js', import.meta.url)
const jobsUrl = new URL('../b_k3ewYvsOEc1/src/composables/useReportJobs.js', import.meta.url)
const appUrl = new URL('../b_k3ewYvsOEc1/src/App.vue', import.meta.url)
const canvasUrl = new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url)

async function loadStateModule() {
  try {
    return await import(stateUrl)
  } catch {
    return null
  }
}

test('identifies only queued and running report jobs as unfinished', async () => {
  const state = await loadStateModule()
  assert.ok(state, 'report workspace state helpers should exist')

  assert.equal(state.isUnfinishedReportJob({ status: 'queued' }), true)
  assert.equal(state.isUnfinishedReportJob({ status: 'running' }), true)
  assert.equal(state.isUnfinishedReportJob({ status: 'succeeded' }), false)
  assert.equal(state.isUnfinishedReportJob({ status: 'failed' }), false)
  assert.equal(state.isUnfinishedReportJob(null), false)
})

test('keeps history jobs separate from the latest active workspace', async () => {
  const state = await loadStateModule()
  assert.ok(state, 'report workspace state helpers should exist')

  const active = { jobId: 'active-a', status: 'running' }
  const history = { jobId: 'history-b', status: 'succeeded' }
  assert.equal(state.resolveActiveWorkspaceJob({ job: active }, history, 'history-b'), active)
  assert.equal(state.resolveActiveWorkspaceJob(null, history, 'history-b'), null)
  assert.deepEqual(state.resolveActiveWorkspaceJob(null, active, ''), active)
  assert.equal(state.resolveActiveWorkspaceJob(null, history, ''), null)
})

test('updates report lists without moving a viewed job unless promotion is requested', async () => {
  const state = await loadStateModule()
  assert.ok(state, 'report workspace state helpers should exist')

  const source = [
    { jobId: 'a', status: 'succeeded' },
    { jobId: 'b', status: 'running' },
    { jobId: 'c', status: 'succeeded' },
  ]
  assert.deepEqual(
    state.upsertReportJob(source, { jobId: 'b', status: 'succeeded' }, { promote: false }).map((item) => item.jobId),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    state.upsertReportJob(source, { jobId: 'b', status: 'running' }, { promote: true }).map((item) => item.jobId),
    ['b', 'a', 'c'],
  )
  assert.deepEqual(
    state.upsertReportJob(source, { jobId: 'd', status: 'queued' }).map((item) => item.jobId),
    ['d', 'a', 'b', 'c'],
  )
})

test('keeps the selected history job visible in recent reports without duplicates', async () => {
  const state = await loadStateModule()
  assert.ok(state, 'report workspace state helpers should exist')

  const recent = [{ jobId: 'a' }, { jobId: 'b' }]
  const selected = { jobId: 'selected-c' }
  assert.deepEqual(state.includeOpenedHistoryJob(recent, 'selected-c', selected), [selected, ...recent])
  assert.deepEqual(state.includeOpenedHistoryJob(recent, 'b', recent[1]), recent)
  assert.deepEqual(state.includeOpenedHistoryJob(recent, 'missing', selected), recent)
})

test('wires isolated switching and concurrent next-report controls into Hermes', async () => {
  const [jobs, app, canvas] = await Promise.all([
    readFile(jobsUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(canvasUrl, 'utf8'),
  ])

  assert.match(jobs, /from '..\/lib\/reportWorkspaceState\.js'/)
  assert.match(jobs, /const isViewingHistoryJob = computed/)
  assert.match(jobs, /phase\.value === 'history-loading'/)
  assert.match(jobs, /if \(!openedHistoryJobId\.value && job\.value\?\.jobId/)
  assert.match(jobs, /stopProgressPolling\(\)\s*\n\s*openedHistoryJobId\.value = item\.jobId/)
  assert.match(jobs, /upsertJobInList\(item, \{ promote: false \}\)/)
  assert.match(jobs, /!isViewingHistoryJob\.value/)
  assert.match(jobs, /const preservedWorkspace = getUnfinishedWorkspaceSnapshot\(\)/)
  assert.match(jobs, /isGenerating\.value = false\s*\n\s*isPlanning\.value = false/)
  assert.match(jobs, /loadingStep\.value = '等待输入任务'/)

  assert.match(app, /function showReportWorkspace\(\)/)
  assert.match(app, /@show-active-workspace="showReportWorkspace"/)
  assert.match(app, /function startReportFromSidebar\([\s\S]*?resetForNewReport\(\)/)

  assert.match(canvas, /props\.phase === 'loading'/)
  assert.match(canvas, /开启下一个编报/)
  assert.match(canvas, /class="source-status-actions"/)
})
