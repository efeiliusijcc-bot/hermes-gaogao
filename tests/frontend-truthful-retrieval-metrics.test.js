import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { getTruthfulSourceStats } from '../b_k3ewYvsOEc1/src/lib/sourceStats.js'

const componentUrl = new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url)

test('retrieval metrics expose each real stage without adding overlapping candidates', () => {
  const stats = getTruthfulSourceStats({
    totalHits: 150,
    vectorPlan: { vectorHits: 100 },
    diagnostics: {
      vectorCandidateCount: 100,
      mergedCandidateCount: 50,
      acceptedCount: 12,
    },
    acceptedSources: Array.from({ length: 12 }, (_, index) => ({ id: index })),
  }, 11)

  assert.deepEqual(stats, {
    initialCandidates: 100,
    fusedCandidates: 50,
    selectedSources: 12,
    visibleSources: 11,
  })
  assert.notEqual(stats.initialCandidates, 150)
})

test('missing stage diagnostics stay unavailable instead of using misleading totals', () => {
  const stats = getTruthfulSourceStats({
    totalHits: 150,
    vectorPlan: { vectorHits: 100 },
  }, 0)

  assert.deepEqual(stats, {
    initialCandidates: 100,
    fusedCandidates: null,
    selectedSources: null,
    visibleSources: 0,
  })
})

test('DataCanvas labels retrieval counters by their actual stage', () => {
  const component = fs.readFileSync(componentUrl, 'utf8')

  for (const label of ['初筛候选', '融合候选', '最终入选', '实际展示']) {
    assert.match(component, new RegExp(label))
  }
  assert.doesNotMatch(component, /<div class="source-stat-title">候选命中<\/div>/)
  assert.doesNotMatch(component, /<div class="source-stat-title">高相关候选<\/div>/)
})
