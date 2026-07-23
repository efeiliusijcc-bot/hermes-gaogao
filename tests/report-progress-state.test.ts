import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportsService } from '../server/reports.service.js';
import type { ReportProgressState } from '../server/types.js';

function remoteFsStub() {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    readdir: async () => [],
    readFile: async () => { throw new Error('missing'); },
    writeFile: async () => undefined,
    exists: async () => false,
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function createService() {
  return new ReportsService(
    {} as never,
    remoteFsStub() as never,
    {} as never,
  ) as unknown as {
    computeProgressState: (job: unknown) => Promise<ReportProgressState>;
  };
}

function event(
  id: string,
  time: string,
  phase: string,
  type: 'stage' | 'tool_start' | 'tool_end' | 'tool_error',
  status: string,
  summary: string,
) {
  return { id, time, phase, type, status, summary, label: '阶段进度', actor: 'main-agent' };
}

function recoveredEventLog() {
  return [
    event('database', '2026-07-22T07:17:27.683Z', 'database_sources', 'stage', 'database_sources', 'PG hybrid sources recalled: 12 items.'),
    event('deep-running', '2026-07-22T07:17:27.766Z', 'deep_source_collection_running', 'stage', 'running', '深度资料采集中。'),
    event('deep-done', '2026-07-22T07:19:30.151Z', 'deep_source_collection_partial', 'stage', 'completed', '深度资料采集部分完成。'),
    event('plan-error', '2026-07-22T07:21:07.766Z', 'context_preparing', 'tool_error', 'failed', '编报任务上下文失败。'),
    event('plan-retry', '2026-07-22T07:21:20.311Z', 'context_preparing', 'tool_start', 'started', '编报任务上下文进行中。'),
    event('plan-done', '2026-07-22T07:21:23.575Z', 'context_preparing', 'tool_end', 'completed', '编报任务上下文已完成。'),
    event('research-done', '2026-07-22T07:24:52.078Z', 'research_collecting', 'tool_end', 'completed', '调研结果文件已完成。'),
    event('research-tool-error', '2026-07-22T07:24:59.562Z', 'research_collecting', 'tool_error', 'failed', '调研结果文件失败。'),
  ];
}

function job(status: 'running' | 'succeeded' | 'failed', eventLog = recoveredEventLog()) {
  return {
    jobId: '94c48c6d-aba3-435f-a75a-8a09e6fbe054',
    skill: 'write-hb',
    payload: { topic: '欧盟与美国科技公司监管冲突编报', deepReportEnabled: true },
    ownerUserId: 'user-1',
    ownerUsername: 'operator',
    ownerRole: 'operator',
    status,
    stage: status === 'succeeded' ? 'quality_review_done' : status,
    artifacts: status === 'succeeded' ? { qualityReviewPath: '/tmp/quality_review.json' } : {},
    resultPath: status === 'succeeded' ? 'reports/job/final/report.md' : undefined,
    createdAt: '2026-07-22T07:17:12.093Z',
    updatedAt: '2026-07-22T07:28:59.983Z',
    events: [],
    eventLog,
  };
}

function statusMap(state: ReportProgressState) {
  return Object.fromEntries(state.stages.map((stage) => [stage.key, stage.status]));
}

test('recovered tool failures do not make earlier stages regress while the job is running', async () => {
  const state = await createService().computeProgressState(job('running'));

  assert.deepEqual(statusMap(state), {
    plan: 'done',
    database: 'done',
    research: 'done',
    deep_collection: 'done',
    consolidate: 'running',
    report: 'not_started',
    quality: 'not_started',
  });
  assert.equal(state.currentStage, 'consolidate');
});

test('a succeeded job authoritatively closes recovered stage errors', async () => {
  const state = await createService().computeProgressState(job('succeeded'));

  assert.ok(state.stages.every((stage) => stage.status === 'done'));
  assert.equal(state.currentStage, 'quality');
  assert.ok(state.stages.find((stage) => stage.key === 'plan')?.evidence.some((item) => item.message.includes('失败')));
});

test('a terminal collection failure remains visible on the actual failed stage', async () => {
  const eventLog = [
    event('database', '2026-07-22T06:25:18.571Z', 'database_sources', 'stage', 'database_sources', 'PG hybrid sources recalled: 12 items.'),
    event('deep-running', '2026-07-22T06:25:18.644Z', 'deep_source_collection_running', 'stage', 'running', '深度资料采集中。'),
    event('deep-failed', '2026-07-22T06:26:42.911Z', 'deep_source_collection_failed', 'stage', 'failed', '深度资料采集失败。'),
  ];
  const failedJob = {
    ...job('failed', eventLog),
    errorMessage: '深度资料采集失败。',
  };
  const state = await createService().computeProgressState(failedJob);

  assert.deepEqual(statusMap(state), {
    plan: 'done',
    database: 'done',
    research: 'done',
    deep_collection: 'failed',
    consolidate: 'not_started',
    report: 'not_started',
    quality: 'not_started',
  });
  assert.equal(state.currentStage, 'deep_collection');
});
