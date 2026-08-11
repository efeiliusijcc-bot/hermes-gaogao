import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dataCanvasSource = readFileSync(new URL('../components/DataCanvas.vue', import.meta.url), 'utf8')
const flowSource = readFileSync(new URL('../components/ReportProgressStageFlow.vue', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../components/ReportTechnicalTimeline.vue', import.meta.url), 'utf8')

test('the same horizontal stage flow is used for live and completed reports', () => {
  const usages = dataCanvasSource.match(/<ReportProgressStageFlow :stages="progressStageFlow" \/>/g) || []
  assert.equal(usages.length, 2)
  assert.doesNotMatch(dataCanvasSource, /class="task-stage-card"/)
  assert.match(flowSource, /report-progress-stage-connector/)
  assert.match(flowSource, /report-progress-stage-current/)
  assert.match(flowSource, /overflow-x: auto/)
})

test('stage summaries follow the reference table hierarchy', () => {
  assert.match(timelineSource, /class="technical-timeline-table-header"/)
  assert.match(timelineSource, /<span>开始时间<\/span>/)
  assert.match(timelineSource, /<span>结束时间<\/span>/)
  assert.match(timelineSource, /<span>耗时<\/span>/)
  assert.match(timelineSource, /class="technical-timeline-stage-current"|`technical-timeline-stage-\$\{group\.status\}`/)
})

test('existing execution log cards and raw record details remain available', () => {
  assert.match(timelineSource, /class="technical-timeline-event"/)
  assert.match(timelineSource, /class="technical-timeline-event-raw"/)
  assert.match(timelineSource, /<summary>原始记录<\/summary>/)
  assert.match(dataCanvasSource, /class="log-new-items-button"/)
})
