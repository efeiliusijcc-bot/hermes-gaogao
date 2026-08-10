import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8')

test('report archive uses a readable table hierarchy without changing its workflows', () => {
  assert.match(appSource, /class="archive-table-grid archive-table-head"/)
  assert.match(appSource, /class="archive-status-badge"/)
  assert.match(appSource, /formatArchiveTime\(item\.updatedAt \|\| item\.createdAt\)/)
  assert.doesNotMatch(appSource, />\{\{ item\.updatedAt \|\| item\.createdAt \}\}<\/div>/)
  assert.match(appSource, /@click="monitorJobFromList\(item\)"/)
  assert.match(appSource, /@click\.stop="deleteReportFromList\(item\)"/)
  assert.match(appSource, /@input="updateListSearch\(\$event\.target\.value\)"/)
})

test('report archive provides wider desktop columns and integrated pagination', () => {
  assert.match(stylesSource, /\.archive-content\s*{[\s\S]*width: min\(100%, 1440px\);/)
  assert.match(stylesSource, /\.archive-table-grid\s*{[\s\S]*grid-template-columns:[^;]*minmax\(300px, 3\.6fr\)/)
  assert.match(stylesSource, /\.archive-time\s*{[\s\S]*white-space: nowrap;/)
  assert.match(appSource, /<footer class="archive-pagination">/)
  assert.match(appSource, /v-for="pageNumber in archivePageNumbers"/)
})
