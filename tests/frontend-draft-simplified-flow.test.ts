import assert from 'node:assert/strict'
import {
  buildDraftAnalyzePayload,
  buildDraftAnalysisSections,
  filterDraftHistory,
  restoredDraftStage,
} from '../b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js'
import { createDraftAutosave } from '../b_k3ewYvsOEc1/src/lib/draftAutosave.js'

const payload = buildDraftAnalyzePayload([
  '  - 美伊技术层级会谈启动',
  '背景材料 https://example.com/a',
  '重点关注涉我风险',
].join('\n'))

assert.equal(payload.title, '美伊技术层级会谈启动')
assert.equal(payload.materials.includes('重点关注涉我风险'), true)
assert.deepEqual(payload.links, ['https://example.com/a'])
assert.equal(payload.category, '')
assert.equal(payload.region, '')
assert.throws(() => buildDraftAnalyzePayload('   '), /请输入编报主体/)

const sections = buildDraftAnalysisSections({
  event: {
    summary: '会谈已经启动',
    actors: ['甲方', '乙方'],
    timeline: [{ time: '7月16日', event: '启动会谈' }],
    region: '维也纳',
    basicFacts: ['事实一', '事实二'],
  },
  analysis: {
    riskSummary: {
      level: 'medium',
      summary: '需持续关注外溢风险',
    },
  },
})

assert.deepEqual(sections.map((item) => item.key), [
  'summary',
  'actors',
  'timeAndPlace',
  'facts',
  'risk',
])
assert.equal(sections.length, 5)
assert.match(sections.find((item) => item.key === 'actors')?.content || '', /甲方/)
assert.match(sections.find((item) => item.key === 'timeAndPlace')?.content || '', /维也纳/)
assert.match(sections.find((item) => item.key === 'risk')?.content || '', /外溢风险/)

assert.deepEqual(
  filterDraftHistory([
    { title: '美伊会谈', summary: '外交进程' },
    { title: '欧盟政策', summary: '产业政策变化' },
  ], '外交').map((item) => item.title),
  ['美伊会谈'],
)
assert.equal(restoredDraftStage({ latestOutline: null }), 'analysis')
assert.equal(restoredDraftStage({ latestOutline: { outlineId: 'outline-1' } }), 'outline')

const timerCallbacks: Array<() => Promise<void>> = []
const saveStates: string[] = []
const savedSnapshots: string[] = []
const coalescingQueue = createDraftAutosave<string>({
  save: async (snapshot) => { savedSnapshots.push(snapshot) },
  onState: (state) => { saveStates.push(state) },
  delay: 10,
  scheduleTimer: (callback) => {
    timerCallbacks.push(callback)
    return timerCallbacks.length
  },
  cancelTimer: () => undefined,
})

coalescingQueue.schedule('first')
coalescingQueue.schedule('latest')
await timerCallbacks.at(-1)?.()
await coalescingQueue.flush()
assert.deepEqual(savedSnapshots, ['latest'])
assert.equal(saveStates.includes('dirty'), true)
assert.equal(saveStates.at(-1), 'saved')

let releaseFirstSave: (() => void) | null = null
const serialSaved: string[] = []
const serialCallbacks: Array<() => Promise<void>> = []
const serialQueue = createDraftAutosave<string>({
  save: async (snapshot) => {
    serialSaved.push(snapshot)
    if (snapshot === 'one') await new Promise<void>((resolve) => { releaseFirstSave = resolve })
  },
  scheduleTimer: (callback) => {
    serialCallbacks.push(callback)
    return serialCallbacks.length
  },
  cancelTimer: () => undefined,
})
serialQueue.schedule('one')
const firstSave = serialCallbacks.at(-1)?.()
serialQueue.schedule('two')
assert.deepEqual(serialSaved, ['one'])
releaseFirstSave?.()
await firstSave
await serialQueue.flush()
assert.deepEqual(serialSaved, ['one', 'two'])

let shouldFail = true
const retryStates: string[] = []
const retryQueue = createDraftAutosave<string>({
  save: async () => {
    if (shouldFail) throw new Error('network down')
  },
  onState: (state) => { retryStates.push(state) },
})
retryQueue.schedule('keep me')
await assert.rejects(() => retryQueue.flush(), /network down/)
shouldFail = false
await retryQueue.retry()
assert.equal(retryStates.includes('error'), true)
assert.equal(retryStates.at(-1), 'saved')

console.log('frontend draft simplified flow tests passed')
