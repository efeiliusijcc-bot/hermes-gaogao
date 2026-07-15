import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const jobsSourceUrl = new URL('../b_k3ewYvsOEc1/src/composables/useReportJobs.js', import.meta.url);
const canvasSourceUrl = new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url);
const timelineSourceUrl = new URL('../b_k3ewYvsOEc1/src/components/ReportTechnicalTimeline.vue', import.meta.url);

test('execution log cache preserves an ISO occurrence timestamp for history and live events', async () => {
  const source = await readFile(jobsSourceUrl, 'utf8');

  assert.match(source, /occurredAt:\s*item\.occurredAt\s*\|\|\s*item\.time\s*\|\|\s*''/);
  assert.match(source, /const occurredAt = new Date\(\)\.toISOString\(\)/);
  assert.match(source, /time:\s*formatLogTime\(occurredAt\)/);
  assert.match(source, /occurredAt,/);
  assert.match(source, /entry\.eventId\s*\|\|\s*entry\.toolId\s*\|\|\s*entry\.id/);
  assert.match(source, /jobLogs\.splice\(0,\s*jobLogs\.length\s*-\s*500\)/);
});

test('DataCanvas reuses the technical timeline for live and historical inline details', async () => {
  const [canvas, timeline] = await Promise.all([
    readFile(canvasSourceUrl, 'utf8'),
    readFile(timelineSourceUrl, 'utf8'),
  ]);

  assert.match(canvas, /import ReportTechnicalTimeline from '.\/ReportTechnicalTimeline\.vue'/);
  assert.match(canvas, /buildReadableExecutionLogs/);
  assert.match(canvas, /readableTechnicalLogs/);
  assert.equal((canvas.match(/<ReportTechnicalTimeline/g) || []).length, 2);
  assert.equal((canvas.match(/:task-status="overallProgressStatus"/g) || []).length, 2);
  assert.match(canvas, /deep_source_collection:\s*\['DEEP_COLLECTION'/);
  assert.match(timeline, /taskStatus/);
  assert.match(timeline, /defaultExpandedTimelineKeys/);
  assert.match(timeline, /原始记录/);
  assert.match(timeline, /状态还原/);
  assert.match(timeline, /actorLabel\(event\.actor\)/);
  assert.match(timeline, /执行角色/);
  assert.match(timeline, /阶段内暂无技术事件/);
  assert.match(timeline, /technical-timeline-event-raw summary::after\s*\{\s*content:\s*none/);
});
