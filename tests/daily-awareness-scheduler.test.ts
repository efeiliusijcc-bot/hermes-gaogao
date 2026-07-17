import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyAwarenessSourceContext,
  previousBusinessDate,
} from '../server/daily-awareness-date.js';
import { DailyAwarenessSchedulerService } from '../server/daily-awareness-scheduler.service.js';
import { dailyAwarenessInboxFailureDisposition } from '../server/daily-awareness-inbox.service.js';
import type { DailyAwarenessInboxRecord } from '../server/daily-awareness.contracts.js';

test('maps a brief business date to the previous MySQL business date', () => {
  assert.equal(previousBusinessDate('2026-07-18'), '2026-07-17');
  assert.equal(previousBusinessDate('2026-03-01'), '2026-02-28');
  assert.equal(previousBusinessDate('2024-03-01'), '2024-02-29');
  assert.equal(previousBusinessDate('2026-01-01'), '2025-12-31');
  assert.throws(() => previousBusinessDate('2026-02-30'), /businessDate/);
});

test('builds the server-owned source context and Shanghai wait deadline', () => {
  assert.deepEqual(dailyAwarenessSourceContext('2026-07-18'), {
    sourceBusinessDate: '2026-07-17',
    sourceTable: 'data_20260717',
    dataWaitDeadline: '2026-07-18T08:00:00+08:00',
  });
});

function schedulerHarness(successful = false) {
  const accepted: Array<{ event: Record<string, unknown>; metadata: Record<string, unknown> }> = [];
  const inbox = {
    acceptScheduled: async (event: Record<string, unknown>, metadata: Record<string, unknown>) => {
      accepted.push({ event, metadata });
      return { accepted: true, duplicate: accepted.length > 1, eventId: event.eventId };
    },
  };
  const store = { hasSuccessfulGlobalBrief: async () => successful };
  const scheduler = new DailyAwarenessSchedulerService(inbox as never, store as never);
  return { scheduler, accepted };
}

test('scheduler does not create an event before 06:00 Asia/Shanghai', async () => {
  process.env.DAILY_AWARENESS_AUTO_ENABLED = 'true';
  process.env.DAILY_AWARENESS_AUTO_TIME = '06:00';
  const { scheduler, accepted } = schedulerHarness();

  const result = await scheduler.ensureScheduled(new Date('2026-07-17T21:59:00.000Z'));

  assert.deepEqual(result, { scheduled: false, reason: 'BEFORE_TIME', businessDate: '2026-07-18' });
  assert.equal(accepted.length, 0);
});

test('scheduler creates a stable catch-up event after 06:00 Asia/Shanghai', async () => {
  process.env.DAILY_AWARENESS_AUTO_ENABLED = 'true';
  process.env.DAILY_AWARENESS_AUTO_TIME = '06:00';
  const { scheduler, accepted } = schedulerHarness();
  const now = new Date('2026-07-17T22:05:00.000Z');

  await scheduler.ensureScheduled(now);
  await scheduler.ensureScheduled(now);

  assert.equal(accepted.length, 2);
  assert.equal(accepted[0].event.eventId, 'daily-awareness:auto:2026-07-18');
  assert.equal(accepted[1].event.eventId, 'daily-awareness:auto:2026-07-18');
  assert.equal(accepted[0].event.businessDate, '2026-07-18');
  assert.equal(accepted[0].event.batchId, 'scheduler:data_20260717');
  assert.deepEqual(accepted[0].metadata, {
    triggerSource: 'AUTO_SCHEDULER',
    sourceBusinessDate: '2026-07-17',
    sourceTable: 'data_20260717',
    dataWaitDeadline: '2026-07-18T08:00:00+08:00',
  });
});

test('scheduler skips a date that already has a successful global brief', async () => {
  process.env.DAILY_AWARENESS_AUTO_ENABLED = 'true';
  const { scheduler, accepted } = schedulerHarness(true);

  const result = await scheduler.ensureScheduled(new Date('2026-07-17T23:00:00.000Z'));

  assert.deepEqual(result, { scheduled: false, reason: 'SUCCESS_EXISTS', businessDate: '2026-07-18' });
  assert.equal(accepted.length, 0);
});

function scheduledItem(attemptCount = 1): DailyAwarenessInboxRecord {
  return {
    eventId: 'daily-awareness:auto:2026-07-18',
    eventType: 'DAILY_DATA_FINISHED',
    businessDate: '2026-07-18',
    batchId: 'scheduler:data_20260717',
    completedAt: '2026-07-18T06:00:00+08:00',
    payload: {
      triggerSource: 'AUTO_SCHEDULER',
      sourceBusinessDate: '2026-07-17',
      sourceTable: 'data_20260717',
      dataWaitDeadline: '2026-07-18T08:00:00+08:00',
    },
    status: 'PROCESSING',
    attemptCount,
  };
}

const missingTableError = Object.assign(new Error('missing data_20260717'), {
  code: 'DAILY_AWARENESS_MYSQL_TABLE_NOT_FOUND',
});

test('missing scheduled source table retries every fifteen minutes until the deadline', () => {
  process.env.DAILY_AWARENESS_DATA_RETRY_MINUTES = '15';
  assert.deepEqual(
    dailyAwarenessInboxFailureDisposition(scheduledItem(20), missingTableError, new Date('2026-07-17T22:00:00.000Z')),
    {
      status: 'RETRY_PENDING',
      nextAttemptAt: '2026-07-17T22:15:00.000Z',
      errorCode: 'DAILY_AWARENESS_SOURCE_TABLE_WAITING',
    },
  );
  assert.equal(
    dailyAwarenessInboxFailureDisposition(scheduledItem(20), missingTableError, new Date('2026-07-17T23:50:00.000Z')).nextAttemptAt,
    '2026-07-18T00:00:00.000Z',
  );
});

test('missing scheduled source table becomes dead letter at the 08:00 deadline', () => {
  assert.deepEqual(
    dailyAwarenessInboxFailureDisposition(scheduledItem(), missingTableError, new Date('2026-07-18T00:00:00.000Z')),
    {
      status: 'DEAD_LETTER',
      nextAttemptAt: null,
      errorCode: 'DAILY_AWARENESS_SOURCE_WAIT_DEADLINE_EXCEEDED',
    },
  );
});

test('non-scheduled and non-missing-table failures keep the normal Inbox retry policy', () => {
  const externalItem = scheduledItem();
  externalItem.payload.triggerSource = 'EXTERNAL_EVENT';
  assert.equal(
    dailyAwarenessInboxFailureDisposition(externalItem, missingTableError, new Date('2026-07-17T22:00:00.000Z')),
    null,
  );
  assert.equal(
    dailyAwarenessInboxFailureDisposition(scheduledItem(), new Error('database unavailable'), new Date('2026-07-17T22:00:00.000Z')),
    null,
  );
});
