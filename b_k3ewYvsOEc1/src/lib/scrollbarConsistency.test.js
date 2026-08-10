import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('visible app scrollbars use the report history scrollbar treatment', () => {
  assert.match(styles, /\*\s*{[\s\S]*scrollbar-width: thin;[\s\S]*scrollbar-color: rgba\(148, 163, 184, 0\.45\) transparent;/)
  assert.match(styles, /::-webkit-scrollbar\s*{\s*width: 6px;\s*height: 6px;/)
  assert.match(styles, /::-webkit-scrollbar-track\s*{\s*background: transparent;/)
  assert.match(styles, /::-webkit-scrollbar-thumb\s*{\s*background: rgba\(148, 163, 184, 0\.45\);\s*border-radius: 999px;/)
  assert.match(styles, /::-webkit-scrollbar-thumb:hover\s*{\s*background: rgba\(37, 99, 235, 0\.45\);/)
})

test('QA no longer overrides the shared scrollbar with a gradient variant', () => {
  assert.doesNotMatch(styles, /\.qa-thread::-webkit-scrollbar/)
  assert.doesNotMatch(styles, /scrollbar-color: rgba\(37, 99, 235, 0\.34\)/)
})
