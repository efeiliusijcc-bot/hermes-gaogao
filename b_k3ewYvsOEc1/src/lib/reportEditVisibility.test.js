import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const canvasSource = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')

test('report local editing stays hidden behind one frontend feature flag', () => {
  assert.match(canvasSource, /const REPORT_EDIT_ENABLED = false/)
  assert.match(canvasSource, /v-if="REPORT_EDIT_ENABLED && job\?\.jobId && generatedHtml"/)
  assert.match(canvasSource, /<aside v-if="REPORT_EDIT_ENABLED && reportEditOpen" class="report-edit-panel">/)
  assert.match(canvasSource, /<button v-if="REPORT_EDIT_ENABLED"[^>]+@click="openReportEditFromQualityIssue\(issue\)"/)
})
