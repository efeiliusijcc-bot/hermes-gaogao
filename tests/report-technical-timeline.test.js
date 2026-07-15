import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportTechnicalTimeline,
  defaultExpandedTimelineKeys,
  formatTimelineDuration,
} from '../b_k3ewYvsOEc1/src/lib/reportTechnicalTimeline.js';

const stages = [
  { key: 'plan', title: '任务规划', desc: '规划', status: 'done' },
  { key: 'database', title: '数据库检索', desc: '数据库', status: 'done' },
  { key: 'research', title: '资料采集', desc: '采集', status: 'done' },
  { key: 'deep_collection', title: '资料深度采集', desc: '深度采集', status: 'done' },
  { key: 'consolidate', title: '素材整合', desc: '整合', status: 'done' },
  { key: 'report', title: '报告撰写', desc: '撰写', status: 'done' },
  { key: 'quality', title: '成稿自检', desc: '自检', status: 'current' },
];

function log(id, stage, occurredAt, status = 'done', extra = {}) {
  return {
    id,
    stage,
    occurredAt,
    time: occurredAt,
    status,
    title: `${stage} title`,
    description: `${stage} description`,
    raw: `${stage} raw`,
    ...extra,
  };
}

test('groups every Hermes workflow stage in business order', () => {
  const timeline = buildReportTechnicalTimeline({
    stages,
    now: '2026-07-15T02:10:00.000Z',
    logs: [
      log('quality', 'QUALITY_REVIEW', '2026-07-15T02:07:00.000Z', 'running'),
      log('report', 'WRITING', '2026-07-15T02:06:00.000Z'),
      log('consolidate', 'SYNTHESIS', '2026-07-15T02:05:00.000Z'),
      log('deep', 'DEEP_COLLECTION', '2026-07-15T02:04:00.000Z'),
      log('research', 'EXTRACTING', '2026-07-15T02:03:00.000Z'),
      log('database', 'PG_RECALL', '2026-07-15T02:02:00.000Z'),
      log('plan', 'CONNECTING', '2026-07-15T02:01:00.000Z'),
    ],
  });

  assert.deepEqual(timeline.map((group) => group.key), stages.map((stage) => stage.key));
  assert.deepEqual(timeline.map((group) => group.eventCount), [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(timeline.at(-1).status, 'current');
  assert.equal(timeline.at(-1).durationLabel, '3分钟');
});

test('uses progress status as authority and only fails the group containing an error', () => {
  const timeline = buildReportTechnicalTimeline({
    stages: [
      { key: 'plan', title: '任务规划', desc: '', status: 'done' },
      { key: 'database', title: '数据库检索', desc: '', status: 'waiting' },
      { key: 'research', title: '资料采集', desc: '', status: 'waiting' },
    ],
    now: '2026-07-15T02:10:00.000Z',
    logs: [
      log('plan-error', 'PLANNING', '2026-07-15T02:01:00.000Z', 'error'),
    ],
  });

  assert.deepEqual(timeline.map((group) => group.status), ['error', 'waiting', 'waiting']);
});

test('sorts events chronologically and places unmapped logs in a final other group', () => {
  const timeline = buildReportTechnicalTimeline({
    stages: stages.slice(0, 2),
    now: '2026-07-15T02:10:00.000Z',
    logs: [
      log('late', 'CONNECTING', '2026-07-15T02:02:00.000Z'),
      log('unknown', 'CUSTOM_EVENT', '2026-07-15T02:03:00.000Z'),
      log('early', 'CONNECTING', '2026-07-15T02:01:00.000Z'),
    ],
  });

  assert.deepEqual(timeline.map((group) => group.key), ['plan', 'database', 'other']);
  assert.deepEqual(timeline[0].events.map((event) => event.id), ['early', 'late']);
  assert.equal(timeline[2].title, '其他技术事件');
  assert.equal(timeline[2].eventCount, 1);
});

test('uses completed progress to close unmatched historical events', () => {
  const timeline = buildReportTechnicalTimeline({
    stages: stages.map((stage) => ({ ...stage, status: 'done' })),
    logs: [
      log('unknown-start', 'CUSTOM_EVENT', '2026-07-15T02:01:00.000Z', 'running'),
      log('unknown-end', 'CUSTOM_EVENT', '2026-07-15T02:02:00.000Z', 'done'),
    ],
  });

  assert.equal(timeline.at(-1).key, 'other');
  assert.equal(timeline.at(-1).status, 'done');
  assert.equal(timeline.at(-1).durationLabel, '1分钟');
});

test('accepts historical ISO timestamps and live occurredAt timestamps consistently', () => {
  const timeline = buildReportTechnicalTimeline({
    stages: stages.slice(0, 1),
    now: '2026-07-15T02:10:00.000Z',
    logs: [
      log('history', 'CONNECTING', '2026-07-15T02:00:00.000Z'),
      { ...log('live', 'TASK_START', '', 'running'), occurredAt: '2026-07-15T02:04:30.000Z', time: '10:04:30' },
    ],
  });

  assert.equal(timeline[0].startedAt, '2026-07-15T02:00:00.000Z');
  assert.equal(timeline[0].endedAt, '2026-07-15T02:04:30.000Z');
  assert.equal(timeline[0].durationMs, 270_000);
});

test('formats compact Chinese durations', () => {
  assert.equal(formatTimelineDuration(null), '');
  assert.equal(formatTimelineDuration(0), '<1秒');
  assert.equal(formatTimelineDuration(61_000), '1分 1秒');
  assert.equal(formatTimelineDuration(3_720_000), '1小时 2分');
});

test('expands only current and failed stages by default', () => {
  assert.deepEqual(defaultExpandedTimelineKeys([
    { key: 'plan', status: 'done' },
    { key: 'research', status: 'current' },
    { key: 'report', status: 'error' },
    { key: 'quality', status: 'waiting' },
  ]), ['research', 'report']);
});

test('returns an empty timeline when the task has no technical events', () => {
  assert.deepEqual(buildReportTechnicalTimeline({ stages, logs: [] }), []);
});
