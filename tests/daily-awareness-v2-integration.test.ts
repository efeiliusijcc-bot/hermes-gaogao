import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../server/app.module.js';
import { DailyAwarenessGenerationService } from '../server/daily-awareness-generation.service.js';
import { DailyAwarenessInboxService } from '../server/daily-awareness-inbox.service.js';
import { DailyAwarenessInternalController } from '../server/daily-awareness.internal.controller.js';
import { DailyAwarenessWorkerService } from '../server/daily-awareness-worker.service.js';
import { InternalEventKeyGuard } from '../server/internal-event-key.guard.js';
import type {
  DailyAwarenessInboxProcessor,
  DailyAwarenessInboxRecord,
  DailyDataFinishedEvent,
} from '../server/daily-awareness.contracts.js';

const baseEvent: DailyDataFinishedEvent = {
  eventId: 'event-success',
  eventType: 'DAILY_DATA_FINISHED',
  businessDate: '2026-07-16',
  batchId: 'batch-success',
  completedAt: '2026-07-16T23:30:00+08:00',
  totalCount: 12,
};

class MemoryStore {
  readonly successfulDates = new Set<string>();
  readonly dayStates = new Map<string, string>();
  readonly runStatuses: string[] = [];
  readonly generatedBy = new Map<string, string>();
  private runSequence = 0;

  async hasSuccessfulGlobalBrief(date: string) { return this.successfulDates.has(date); }
  async loadConfig() {
    return { lookbackHours: 24, maxArticles: 50, categoryScope: [], maxRetryCount: 0, retryIntervalSeconds: 1, summaryMaxChars: 1200, version: 1 };
  }
  async startRun() { return `run-${++this.runSequence}`; }
  async startQueuedRun(runId: string) { return runId; }
  async queueManualRun() { return `manual-${++this.runSequence}`; }
  async recordIgnored(item: DailyAwarenessInboxRecord) {
    this.runStatuses.push(`IGNORED_DUPLICATE:${item.businessDate}`);
  }
  async completeNoData(_runId: string, item: DailyAwarenessInboxRecord) {
    this.dayStates.set(item.businessDate, 'NO_DATA');
    this.runStatuses.push(`NO_DATA:${item.businessDate}`);
  }
  async failRun(_runId: string, _error: unknown, terminal: boolean) {
    if (terminal) this.runStatuses.push('GENERATION_FAILED');
  }
  async saveSuccess(
    _runId: string,
    item: DailyAwarenessInboxRecord,
    _prepared: unknown,
    _composed: unknown,
    generatedByType: string,
  ) {
    this.successfulDates.add(item.businessDate);
    this.dayStates.set(item.businessDate, 'SUCCESS');
    this.generatedBy.set(item.businessDate, generatedByType);
    this.runStatuses.push(`SUCCESS:${item.businessDate}:${generatedByType}`);
  }
}

class MemoryInbox {
  readonly items = new Map<string, DailyAwarenessInboxRecord>();
  private processor: DailyAwarenessInboxProcessor | null = null;
  constructor(private readonly successfulDates: Set<string>) {}

  async accept(event: DailyDataFinishedEvent) {
    const duplicate = this.items.has(event.eventId);
    if (!duplicate) {
      this.items.set(event.eventId, { ...event, payload: { ...event }, status: 'RECEIVED', attemptCount: 0 });
    }
    return { accepted: true as const, duplicate, eventId: event.eventId };
  }
  registerProcessor(processor: DailyAwarenessInboxProcessor) {
    this.processor = processor;
    return () => { if (this.processor === processor) this.processor = null; };
  }
  registerWakeHandler() { return () => undefined; }
  async recoverStaleProcessing() { return 0; }
  async claimNext() {
    const item = [...this.items.values()].find((candidate) => candidate.status === 'RECEIVED' || candidate.status === 'RETRY_PENDING');
    if (!item) return null;
    item.status = 'PROCESSING';
    item.attemptCount += 1;
    return { ...item, payload: { ...item.payload } };
  }
  async process(item: DailyAwarenessInboxRecord) {
    if (!this.processor) throw new Error('processor missing');
    return this.processor(item);
  }
  async markProcessed(eventId: string) {
    const item = this.items.get(eventId);
    if (item) item.status = 'PROCESSED';
  }
  async markInfrastructureFailure(item: DailyAwarenessInboxRecord) {
    const stored = this.items.get(item.eventId);
    if (stored) stored.status = item.attemptCount >= 2 ? 'DEAD_LETTER' : 'RETRY_PENDING';
  }
  async reprocess(eventId: string) {
    const item = this.items.get(eventId);
    if (!item) throw new Error('event missing');
    if (this.successfulDates.has(item.businessDate)) throw new Error('DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS');
    if (item.status !== 'DEAD_LETTER') throw new Error('Only dead-letter events can be reprocessed');
    item.status = 'RETRY_PENDING';
    item.attemptCount = 0;
    item.payload = { ...item.payload, reprocessRequested: true };
    return { accepted: true as const, eventId, status: 'RETRY_PENDING' as const };
  }
  onModuleDestroy() {}
}

test('internal event, Inbox worker, generation state, replay, and manual overwrite integrate', async () => {
  process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY = 'integration-secret';
  const store = new MemoryStore();
  const inbox = new MemoryInbox(store.successfulDates);
  const materialFailures = new Set(['2026-07-19']);
  let composeCalls = 0;
  const materials = {
    prepareForBusinessDate: async (date: string) => {
      if (materialFailures.has(date)) throw new Error('vector database unavailable');
      const sourceCount = date === '2026-07-17' ? 0 : 1;
      return { materials: [], candidates: [], sourceCount, summaryCount: sourceCount, titleOnlyCount: 0, skippedCount: 0, qualityStatus: sourceCount ? 'NORMAL' : null, diagnostics: {} };
    },
  };
  const locks = {
    withBusinessDateLock: async (_date: string, _mode: string, work: () => Promise<unknown>) => ({ acquired: true, value: await work() }),
  };
  const composer = {
    composeGlobalBrief: async (date: string) => {
      composeCalls += 1;
      if (date === '2026-07-18') throw new Error('model output rejected');
      return { title: `${date} 每日动态简报`, summary: '摘要', reportMarkdown: '# 每日动态简报\n\n这是一段长度足够且可用于集成测试的正式简报正文内容，用于确认成功状态、持久化边界以及人工覆盖路径。', contentJson: {}, categoryStats: [], events: [] };
    },
  };
  const generation = new DailyAwarenessGenerationService(materials as never, locks as never, composer as never, inbox as never, store as never);
  const worker = new DailyAwarenessWorkerService(inbox as never);

  @Module({
    controllers: [DailyAwarenessInternalController],
    providers: [
      InternalEventKeyGuard,
      { provide: DailyAwarenessInboxService, useValue: inbox },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const endpoint = `http://127.0.0.1:${port}/internal/events/daily-data-finished`;

  async function post(event: DailyDataFinishedEvent) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'integration-secret' },
      body: JSON.stringify(event),
    });
  }

  try {
    const accepted = await post(baseEvent);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false, eventId: baseEvent.eventId });

    const duplicate = await post(baseEvent);
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(await worker.processAvailable(), 1);
    assert.equal(inbox.items.get(baseEvent.eventId)?.status, 'PROCESSED');
    assert.equal(store.dayStates.get('2026-07-16'), 'SUCCESS');

    await post({ ...baseEvent, eventId: 'event-no-data', businessDate: '2026-07-17', batchId: 'batch-no-data', totalCount: 0 });
    await worker.processAvailable();
    assert.equal(store.dayStates.get('2026-07-17'), 'NO_DATA');
    assert.equal(composeCalls, 1);

    await post({ ...baseEvent, eventId: 'event-model-failed', businessDate: '2026-07-18', batchId: 'batch-model-failed' });
    await worker.processAvailable();
    assert.equal(inbox.items.get('event-model-failed')?.status, 'PROCESSED');
    assert.ok(store.runStatuses.includes('GENERATION_FAILED'));

    await post({ ...baseEvent, eventId: 'event-dead-letter', businessDate: '2026-07-19', batchId: 'batch-dead-letter' });
    await worker.processAvailable();
    await worker.processAvailable();
    assert.equal(inbox.items.get('event-dead-letter')?.status, 'DEAD_LETTER');
    materialFailures.delete('2026-07-19');
    assert.equal((await inbox.reprocess('event-dead-letter')).status, 'RETRY_PENDING');
    await worker.processAvailable();
    assert.equal(store.dayStates.get('2026-07-19'), 'SUCCESS');

    inbox.items.get(baseEvent.eventId)!.status = 'DEAD_LETTER';
    await assert.rejects(() => inbox.reprocess(baseEvent.eventId), /DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS/);

    const manual = await generation.regenerate({ businessDate: '2026-07-16', reason: '人工复核后补生成', confirmOverwrite: true }, { id: 'admin-1' });
    assert.match(manual.runId, /^manual-/);
    for (let attempt = 0; attempt < 20 && store.generatedBy.get('2026-07-16') !== 'MANUAL'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(store.generatedBy.get('2026-07-16'), 'MANUAL');
  } finally {
    generation.onModuleDestroy();
    worker.onModuleDestroy();
    await app.close();
    delete process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY;
  }
});

test('AppModule and deployment files expose the complete daily awareness contract', async () => {
  const controllers = Reflect.getMetadata('controllers', AppModule) as unknown[];
  const providers = Reflect.getMetadata('providers', AppModule) as unknown[];
  assert.ok(controllers.includes(DailyAwarenessInternalController));
  assert.ok(providers.includes(DailyAwarenessInboxService));
  assert.ok(providers.includes(DailyAwarenessGenerationService));
  assert.ok(providers.includes(DailyAwarenessWorkerService));

  const [env, deploy, readme] = await Promise.all([
    readFile(new URL('../.env.example', import.meta.url), 'utf8'),
    readFile(new URL('../deploy.sh', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);
  for (const name of [
    'DAILY_AWARENESS_INTERNAL_EVENT_KEY',
    'DAILY_AWARENESS_WORKER_POLL_MS',
    'DAILY_AWARENESS_INBOX_LEASE_SECONDS',
    'DAILY_AWARENESS_INBOX_MAX_ATTEMPTS',
    'DAILY_AWARENESS_INBOX_RETRY_SECONDS',
    'DAILY_AWARENESS_MYSQL_HOST',
    'DAILY_AWARENESS_MYSQL_PORT',
    'DAILY_AWARENESS_MYSQL_DATABASE',
    'DAILY_AWARENESS_MYSQL_USER',
    'DAILY_AWARENESS_MYSQL_PASSWORD',
    'DAILY_AWARENESS_MYSQL_TABLE_PREFIX',
  ]) {
    assert.match(env, new RegExp(`^${name}=`, 'm'));
    assert.match(deploy, new RegExp(name));
  }
  assert.match(readme, /POST \/internal\/events\/daily-data-finished/);
  assert.match(readme, /X-Hermes-Internal-Key/);
  assert.match(readme, /schema.*permission.*backend.*frontend.*writer/is);
  assert.match(readme, /MySQL.*news.*data_YYYYMMDD/is);
  assert.match(readme, /my_mysql.*hermes-net/is);
});
