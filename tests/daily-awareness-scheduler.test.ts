import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyAwarenessSourceContext,
  previousBusinessDate,
} from '../server/daily-awareness-date.js';
import { DailyAwarenessSchedulerService } from '../server/daily-awareness-scheduler.service.js';

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
