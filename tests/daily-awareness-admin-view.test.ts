import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTodaySummary,
  dailyAwarenessIssueLabel,
  dailyAwarenessStatusLabel,
  mergeDailyAwarenessHistory,
} from '../b_k3ewYvsOEc1/src/lib/dailyAwarenessAdminView.js';

test('maps a successful day to a readable summary with the actual selected count', () => {
  assert.deepEqual(buildTodaySummary({
    business_date: '2026-07-20',
    data_status: 'READY',
    generation_status: 'SUCCESS',
    source_business_date: '2026-07-19',
    selected_count: 50,
    generated_at: '2026-07-20T06:43:00.000Z',
  }), {
    label: '今日简报已生成',
    description: '生成完成后，普通用户即可查看。',
    tone: 'success',
    businessDate: '2026-07-20',
    sourceBusinessDate: '2026-07-19',
    selectedCount: 50,
    generatedAt: '2026-07-20T06:43:00.000Z',
    action: 'view',
  });
});

test('maps non-success day states to a clear next action', () => {
  assert.equal(buildTodaySummary({ generation_status: 'GENERATING' }).label, '正在生成');
  assert.equal(buildTodaySummary({ generation_status: 'GENERATION_FAILED' }).action, 'issues');
  assert.equal(buildTodaySummary({ data_status: 'NO_DATA', generation_status: 'NOT_REQUIRED' }).label, '昨日暂无可用数据');
  assert.equal(buildTodaySummary({ generation_status: 'WAITING' }).action, 'refresh');
});

test('maps Inbox states without exposing technical enum labels', () => {
  assert.deepEqual(dailyAwarenessStatusLabel('DEAD_LETTER'), { label: '需要人工处理', tone: 'danger' });
  assert.equal(dailyAwarenessIssueLabel({ status: 'RETRY_PENDING' }).label, '正在自动恢复');
  assert.equal(dailyAwarenessIssueLabel({ status: 'PROCESSING' }).label, '正在生成');
  assert.equal(dailyAwarenessIssueLabel({ status: 'RECEIVED' }).label, '即将开始');
  assert.equal(dailyAwarenessIssueLabel({ status: 'PROCESSED' }).label, '已解决');
});

test('merges retries into one successful row per business date', () => {
  const rows = mergeDailyAwarenessHistory([
    {
      id: 'run-failed',
      businessDate: '2026-07-19',
      triggerType: 'EVENT',
      status: 'FAILED',
      sourceBusinessDate: '2026-07-18',
      createdAt: '2026-07-19T06:00:00.000Z',
      errorMessage: 'failed',
    },
    {
      id: 'run-success',
      businessDate: '2026-07-19',
      triggerType: 'INBOX_REPROCESS',
      status: 'SUCCESS',
      sourceBusinessDate: '2026-07-18',
      finishedAt: '2026-07-20T00:43:00.000Z',
      createdAt: '2026-07-20T00:16:00.000Z',
    },
  ], [{
    briefId: 'brief-1',
    businessDate: '2026-07-19',
    sourceBusinessDate: '2026-07-18',
    selectedCount: 50,
    generatedAt: '2026-07-20T00:43:00.000Z',
  }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].businessDate, '2026-07-19');
  assert.equal(rows[0].resultLabel, '补生成成功');
  assert.equal(rows[0].selectedCount, 50);
  assert.equal(rows[0].action, 'view');
  assert.equal(rows[0].runs.length, 2);
  assert.equal(rows[0].latestRun.id, 'run-success');
});

test('keeps failed and no-data dates actionable without inventing a brief', () => {
  const rows = mergeDailyAwarenessHistory([
    { id: 'run-failed', businessDate: '2026-07-18', status: 'FAILED', createdAt: '2026-07-18T06:00:00.000Z' },
    { id: 'run-empty', businessDate: '2026-07-17', status: 'NO_DATA', createdAt: '2026-07-17T06:00:00.000Z' },
  ], []);

  assert.equal(rows[0].resultLabel, '未生成');
  assert.equal(rows[0].action, 'regenerate');
  assert.equal(rows[1].resultLabel, '暂无数据');
  assert.equal(rows[1].action, 'inspect');
});
