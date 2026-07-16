import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyAwarenessConfigService } from '../server/daily-awareness-config.service.js';
import { DailyAwarenessGenerationService } from '../server/daily-awareness-generation.service.js';
import { DailyAwarenessInboxService } from '../server/daily-awareness-inbox.service.js';

function responseCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
  return String(response?.code || '');
}

test('config update rejects a stale version and invalid ranges', async () => {
  const service = new DailyAwarenessConfigService() as DailyAwarenessConfigService & {
    getPool: () => Promise<{ query: () => Promise<{ rows: Array<Record<string, unknown>> }> }>;
  };
  service.getPool = async () => ({ query: async () => ({ rows: [] }) });

  await assert.rejects(
    () => service.update({
      lookbackHours: 24,
      maxArticles: 50,
      categoryScope: [],
      maxRetryCount: 3,
      retryIntervalSeconds: 30,
      summaryMaxChars: 1200,
      version: 4,
    }, 'admin-1'),
    (error) => responseCode(error) === 'DAILY_AWARENESS_CONFIG_VERSION_CONFLICT',
  );

  await assert.rejects(
    () => service.update({
      lookbackHours: 0,
      maxArticles: 50,
      categoryScope: [],
      maxRetryCount: 3,
      retryIntervalSeconds: 30,
      summaryMaxChars: 1200,
      version: 1,
    }, 'admin-1'),
    (error) => responseCode(error) === 'DAILY_AWARENESS_INVALID_CONFIG',
  );
});

test('Inbox reprocess refuses to overwrite a successful global brief', async () => {
  const service = new DailyAwarenessInboxService() as DailyAwarenessInboxService & {
    getPool: () => Promise<{ query: () => Promise<{ rows: Array<Record<string, unknown>> }> }>;
  };
  service.getPool = async () => ({
    query: async () => ({ rows: [{ event_id: 'event-1', status: 'DEAD_LETTER', business_date: '2026-07-16', has_success: true }] }),
  });

  await assert.rejects(
    () => service.reprocess('event-1', 'admin-1'),
    (error) => responseCode(error) === 'DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS',
  );
});

test('Inbox reprocess resets a dead letter and wakes the worker', async () => {
  const queries: string[] = [];
  let wakeCalls = 0;
  const service = new DailyAwarenessInboxService() as DailyAwarenessInboxService & {
    getPool: () => Promise<{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }>;
    wake: () => void;
  };
  service.getPool = async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('has_success')) {
        return { rows: [{ event_id: 'event-1', status: 'DEAD_LETTER', business_date: '2026-07-16', has_success: false }] };
      }
      return { rows: [{ event_id: 'event-1' }] };
    },
  });
  service.wake = () => { wakeCalls += 1; };

  const result = await service.reprocess('event-1', 'admin-1');

  assert.deepEqual(result, { accepted: true, eventId: 'event-1', status: 'RETRY_PENDING' });
  assert.ok(queries.some((sql) => sql.includes("status = 'RETRY_PENDING'")));
  assert.equal(wakeCalls, 1);
});

test('manual regeneration requires reason and explicit overwrite confirmation and only queues work', async () => {
  let composeCalls = 0;
  const store = {
    queueManualRun: async () => 'run-manual',
  };
  const generation = new DailyAwarenessGenerationService(
    {} as never,
    {} as never,
    { composeGlobalBrief: async () => { composeCalls += 1; } } as never,
    { registerProcessor: () => () => undefined } as never,
    store as never,
  ) as DailyAwarenessGenerationService & { scheduleManual: () => void };
  generation.scheduleManual = () => undefined;

  await assert.rejects(
    () => generation.regenerate({ businessDate: '2026-07-16', reason: '', confirmOverwrite: true }, { id: 'admin-1' } as never),
    (error) => responseCode(error) === 'DAILY_AWARENESS_INVALID_CONFIG',
  );
  await assert.rejects(
    () => generation.regenerate({ businessDate: '2026-07-16', reason: '额度恢复', confirmOverwrite: false }, { id: 'admin-1' } as never),
    (error) => responseCode(error) === 'DAILY_AWARENESS_INVALID_CONFIG',
  );

  const result = await generation.regenerate(
    { businessDate: '2026-07-16', reason: '额度恢复', confirmOverwrite: true },
    { id: 'admin-1' } as never,
  );
  assert.deepEqual(result, { runId: 'run-manual', status: 'QUEUED' });
  assert.equal(composeCalls, 0);
});
