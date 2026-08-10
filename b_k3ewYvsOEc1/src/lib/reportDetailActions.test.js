import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const canvasSource = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')

test('report detail actions do not duplicate the sidebar report list entry', () => {
  const detailActions = canvasSource.match(/<div class="result-actions">([\s\S]*?)<\/div>/)?.[1] || ''

  assert.doesNotMatch(detailActions, /报告列表/)
  assert.doesNotMatch(detailActions, /emit\('list'\)/)
  assert.match(canvasSource, /<button @click="emit\('list'\)" class="sci-btn[^>]*>报告列表<\/button>/)
  assert.match(canvasSource, /返回报告列表/)
})
