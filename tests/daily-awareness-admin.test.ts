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
      categoryScope: ['其他'],
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

test('config validation accepts only fixed daily awareness categories and rejects an empty new selection', async () => {
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
      version: 1,
    }, 'admin-1'),
    (error) => responseCode(error) === 'DAILY_AWARENESS_INVALID_CONFIG',
  );
  await assert.rejects(
    () => service.update({
      lookbackHours: 24,
      maxArticles: 50,
      categoryScope: ['未知分类'],
      maxRetryCount: 3,
      retryIntervalSeconds: 30,
      summaryMaxChars: 1200,
      version: 1,
    }, 'admin-1'),
    (error) => responseCode(error) === 'DAILY_AWARENESS_INVALID_CONFIG',
  );
});

test('legacy empty category scope reads as all four MySQL categories', async () => {
  const service = new DailyAwarenessConfigService() as DailyAwarenessConfigService & {
    getPool: () => Promise<{ query: () => Promise<{ rows: Array<Record<string, unknown>> }> }>;
  };
  service.getPool = async () => ({ query: async () => ({ rows: [{ category_scope: [], version: 2 }] }) });
  assert.deepEqual((await service.get()).categoryScope, ['涉政', '危安', '涉华', '其他']);
});

test('admin run response exposes source date, table, and wait deadline', async () => {
  const service = new (await import('../server/daily-awareness-admin.service.js')).DailyAwarenessAdminService() as never as {
    run: (id: string) => Promise<Record<string, unknown>>;
    getPool: () => Promise<{ query: () => Promise<{ rows: Array<Record<string, unknown>> }> }>;
  };
  service.getPool = async () => ({
    query: async () => ({ rows: [{
      id: 'run-1',
      business_date: '2026-07-18',
      status: 'RUNNING',
      source_business_date: '2026-07-17',
      source_table: 'data_20260717',
      data_wait_deadline: '2026-07-18T00:00:00.000Z',
    }] }),
  });

  const run = await service.run('run-1');
  assert.equal(run.sourceBusinessDate, '2026-07-17');
  assert.equal(run.sourceTable, 'data_20260717');
  assert.equal(run.dataWaitDeadline, '2026-07-18T00:00:00.000Z');
});

test('admin status joins the latest run source and Inbox retry timing', async () => {
  let sql = '';
  const service = new (await import('../server/daily-awareness-admin.service.js')).DailyAwarenessAdminService() as never as {
    status: (businessDate: string) => Promise<Record<string, unknown>>;
    getPool: () => Promise<{ query: (query: string) => Promise<{ rows: Array<Record<string, unknown>> }> }>;
  };
  service.getPool = async () => ({
    query: async (query: string) => {
      sql = query;
      return { rows: [{
        business_date: '2026-07-18',
        source_business_date: '2026-07-17',
        source_table: 'data_20260717',
        data_wait_deadline: '2026-07-18T00:00:00.000Z',
        next_attempt_at: '2026-07-17T22:15:00.000Z',
        selected_count: 50,
        generated_at: '2026-07-18T00:10:00.000Z',
      }] };
    },
  });

  const status = await service.status('2026-07-18');
  assert.equal(status.source_table, 'data_20260717');
  assert.equal(status.next_attempt_at, '2026-07-17T22:15:00.000Z');
  assert.equal(status.selected_count, 50);
  assert.equal(status.generated_at, '2026-07-18T00:10:00.000Z');
  assert.match(sql, /LEFT JOIN daily_awareness_runs run ON run\.id = day\.last_run_id/);
  assert.match(sql, /LEFT JOIN daily_awareness_event_inbox inbox ON inbox\.event_id = run\.trigger_ref/);
  assert.match(sql, /LEFT JOIN daily_briefs brief ON brief\.brief_id = day\.current_brief_id/);
  assert.match(sql, /brief\.selected_count/);
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
