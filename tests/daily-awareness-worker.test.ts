import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyAwarenessLockService } from '../server/daily-awareness-lock.service.js';
import { DailyAwarenessWorkerService } from '../server/daily-awareness-worker.service.js';
import type { DailyAwarenessInboxRecord } from '../server/daily-awareness.contracts.js';

function inboxRecord(): DailyAwarenessInboxRecord {
  return {
    eventId: 'event-1',
    eventType: 'DAILY_DATA_FINISHED',
    businessDate: '2026-07-16',
    batchId: 'batch-1',
    completedAt: '2026-07-17T06:10:00.000Z',
    totalCount: 10,
    payload: {},
    status: 'PROCESSING',
    attemptCount: 1,
  };
}

test('worker marks business-terminal model failures processed', async () => {
  const item = inboxRecord();
  const calls: string[] = [];
  let claimed = false;
  const inbox = {
    registerWakeHandler: () => () => undefined,
    recoverStaleProcessing: async () => 0,
    claimNext: async () => {
      if (claimed) return null;
      claimed = true;
      return item;
    },
    process: async () => ({ terminal: true as const, generationStatus: 'GENERATION_FAILED' as const }),
    markProcessed: async (eventId: string) => calls.push(`processed:${eventId}`),
    markInfrastructureFailure: async () => calls.push('retry'),
  };
  const worker = new DailyAwarenessWorkerService(inbox as never);

  assert.equal(await worker.processAvailable(), 1);
  assert.deepEqual(calls, ['processed:event-1']);
});

test('worker retries infrastructure failures instead of marking them processed', async () => {
  const item = inboxRecord();
  const calls: string[] = [];
  let claimed = false;
  const inbox = {
    registerWakeHandler: () => () => undefined,
    recoverStaleProcessing: async () => 0,
    claimNext: async () => {
      if (claimed) return null;
      claimed = true;
      return item;
    },
    process: async () => {
      throw new Error('database unavailable');
    },
    markProcessed: async () => calls.push('processed'),
    markInfrastructureFailure: async (record: DailyAwarenessInboxRecord) => calls.push(`retry:${record.eventId}`),
  };
  const worker = new DailyAwarenessWorkerService(inbox as never);

  assert.equal(await worker.processAvailable(), 1);
  assert.deepEqual(calls, ['retry:event-1']);
});

test('business-date lock uses one dedicated connection and always unlocks', async () => {
  const queries: string[] = [];
  let released = 0;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      return { rows: [{ unlocked: true }] };
    },
    release: () => { released += 1; },
  };
  const pool = { connect: async () => client, end: async () => undefined };
  const lock = new DailyAwarenessLockService() as DailyAwarenessLockService & { getPool: () => Promise<typeof pool> };
  lock.getPool = async () => pool;

  const result = await lock.withBusinessDateLock('2026-07-16', 'EVENT', async () => 'done');

  assert.deepEqual(result, { acquired: true, value: 'done' });
  assert.match(queries[0], /pg_try_advisory_lock/);
  assert.match(queries.at(-1) || '', /pg_advisory_unlock/);
  assert.equal(released, 1);
  assert.ok(queries.every((sql) => !/^BEGIN|^COMMIT/i.test(sql.trim())));
});
