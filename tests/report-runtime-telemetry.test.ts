import assert from 'node:assert/strict';
import test from 'node:test';

import { ReportsService } from '../server/reports.service.js';
import type { EventLogEntry, JobRecord, ServerEvent } from '../server/types.js';

function createService() {
  const remoteFs = {
    remoteDir: '/tmp/hermes-runtime-telemetry',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    readdir: async () => [],
    readFile: async () => { throw new Error('missing'); },
    writeFile: async () => undefined,
    mkdir: async () => undefined,
    exists: async () => false,
    stat: async () => ({ size: 0, mtimeMs: Date.now(), isFile: false }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
  return new ReportsService({} as never, remoteFs as never, {} as never) as unknown as {
    parseResearchHarnessProgress(line: string): ServerEvent | null;
    toEventLogEntry(job: JobRecord, event: ServerEvent): EventLogEntry | null;
    sanitizeEventLogEntry(entry: EventLogEntry): EventLogEntry;
    computeProgressState(job: JobRecord): Promise<JobRecord['progressState']>;
  };
}

function job(eventLog: EventLogEntry[] = []): JobRecord {
  return {
    jobId: 'runtime-telemetry-job',
    skill: 'write-hb',
    payload: { topic: '测试', report_type: 'K报', deepReportEnabled: true },
    ownerUserId: 'user-1',
    ownerUsername: 'operator',
    status: 'running',
    artifacts: {},
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    events: [],
    eventLog,
  };
}

test('turns safe harness JSONL into timestamped persisted execution evidence', () => {
  const service = createService();
  const event = service.parseResearchHarnessProgress(JSON.stringify({
    occurredAt: '2026-09-05T01:02:03.000Z',
    origin: 'research_harness',
    runEvent: 'research.progress',
    sequence: 7,
    phase: 'research_group',
    status: 'completed',
    summary: '调研分组 A 已完成。',
    metrics: { sources: 12, durationMs: 3456, query: 'must not pass through' },
  }));
  assert.ok(event);
  assert.equal(event.type, 'stage');
  assert.equal(event.origin, 'research_harness');
  assert.equal(event.sequence, 7);
  assert.equal(event.durationMs, 3456);

  const entry = service.toEventLogEntry(job(), event);
  assert.ok(entry);
  assert.equal(entry.time, '2026-09-05T01:02:03.000Z');
  assert.equal(entry.actor, 'research-agent');
  assert.equal(entry.runEvent, 'research.progress');
  assert.equal(entry.command, undefined);
  assert.doesNotMatch(JSON.stringify(entry), /must not pass through/);
});

test('retains safe Hermes timing and usage fields without arbitrary values', () => {
  const service = createService();
  const entry = service.toEventLogEntry(job(), {
    type: 'tool_end',
    id: 'run-1:tool:1',
    name: 'execute_code',
    raw: { label: '执行编报脚本', summary: '编报脚本执行完成。', status: 'completed' },
    occurredAt: '2026-09-05T01:02:03.000Z',
    origin: 'hermes_agent',
    durationMs: 1200,
    sequence: 8,
    runEvent: 'tool.completed',
    usage: { input_tokens: 120, output_tokens: 30 },
  });
  assert.ok(entry);
  assert.equal(entry.durationMs, 1200);
  assert.deepEqual(entry.usage, { input_tokens: 120, output_tokens: 30 });

  const sanitized = service.sanitizeEventLogEntry({
    ...entry,
    usage: { input_tokens: 120, invalid: -1 },
  });
  assert.deepEqual(sanitized.usage, { input_tokens: 120 });
});

test('maps the final harness event to the single deep collection stage', async () => {
  const service = createService();
  const currentJob = job([{
    id: 'harness-done',
    time: '2026-09-05T01:02:03.000Z',
    type: 'stage',
    label: '资料采集执行',
    status: 'research_harness_done_completed',
    phase: 'research_harness_done_completed',
    actor: 'research-agent',
    summary: '资料深度采集、整合与校验已完成。',
    origin: 'research_harness',
    sequence: 9,
    runEvent: 'research.progress',
  }]);
  const state = await service.computeProgressState(currentJob);
  assert.ok(state);
  assert.equal(state.stages.some((stage) => stage.key === 'research'), false);
  assert.equal(state.stages.find((stage) => stage.key === 'deep_collection')?.status, 'done');
});
