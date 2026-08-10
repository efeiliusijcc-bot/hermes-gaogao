import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const historySource = readFileSync(new URL('../components/DraftHistorySidebar.vue', import.meta.url), 'utf8')

test('overflowing draft history titles scroll on hover without moving the date column', () => {
  assert.match(historySource, /function prepareHistoryTitle\(event\)/)
  assert.match(historySource, /track\.scrollWidth - viewport\.clientWidth/)
  assert.match(historySource, /class="draft-history-title-viewport"/)
  assert.match(historySource, /class="draft-history-title-track"/)
  assert.match(historySource, /grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(historySource, /@keyframes draft-history-title-scroll/)
  assert.match(historySource, /animation: draft-history-title-scroll var\(--draft-title-duration\)/)
})

test('draft history title movement respects reduced motion preferences', () => {
  assert.match(historySource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;/)
})
