import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const panelSource = readFileSync(new URL('../components/ControlPanel.vue', import.meta.url), 'utf8')
const draftHistorySource = readFileSync(new URL('../components/DraftHistorySidebar.vue', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('overflowing report history titles scroll while metadata and arrows remain outside the title viewport', () => {
  assert.match(panelSource, /function prepareRecentTitle\(event\)/)
  assert.match(panelSource, /track\.scrollWidth - viewport\.clientWidth/)
  assert.match(panelSource, /class="recent-title-viewport"/)
  assert.match(panelSource, /class="recent-title recent-title-track font-mono text-xs"/)
  assert.match(panelSource, /<span class="ml-auto text-\[#64748b\] shrink-0">›<\/span>/)
  assert.match(stylesSource, /@keyframes recent-title-scroll/)
  assert.match(stylesSource, /animation: recent-title-scroll var\(--recent-title-duration\)/)
})

test('report history title scrolling is faster than draft history and respects reduced motion', () => {
  assert.match(panelSource, /distance \/ 42 \+ 0\.7/)
  assert.match(draftHistorySource, /distance \/ 32 \+ 1\.2/)
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.recent-item:hover[\s\S]*animation: none;/)
})
