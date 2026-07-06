import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CrawlerController, InternalCrawlerController } from '../server/crawler.controller.js';
import { CrawlerService } from '../server/crawler.service.js';
import { HermesService } from '../server/hermes.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

type Query = { text: string; params?: unknown[] };

function user(id: string, role: AuthUser['role'], permissions: string[]): AuthUser {
  return { id, username: `${role}-${id}`, displayName: '', email: null, role, roles: [role], permissions };
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) return JSON.stringify((error as { response?: unknown }).response);
  return error instanceof Error ? error.message : String(error);
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    task_id: '11111111-1111-4111-8111-111111111111',
    owner_id: 'user-1',
    owner_username: 'operator-user-1',
    job_id: 'job-1',
    title: '资料采集任务',
    goal: '补充公开资料',
    status: 'pending',
    crawler_plan: {
      enabled: true,
      mode: 'manual',
      goal: '补充公开资料',
      manualUrls: ['https://example.com/report'],
      manualDomains: [],
      manualKeywords: [],
      directions: [],
      maxPages: 10,
      maxDepth: 1,
      executePhase: 'research',
    },
    max_pages: 10,
    max_depth: 1,
    error_message: null,
    created_at: '2026-07-06T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    item_id: '22222222-2222-4222-8222-222222222222',
    task_id: '11111111-1111-4111-8111-111111111111',
    owner_id: 'user-1',
    job_id: 'job-1',
    url: 'https://example.com/report',
    title: 'Example Report',
    publisher: 'example.com',
    published_at: null,
    fetched_at: '2026-07-06T00:01:00.000Z',
    content_text: 'Example content',
    content_summary: 'Example content',
    metadata: { fetchedBy: 'controlled-web-collector' },
    relevance_score: 50,
    credibility_score: 50,
    created_at: '2026-07-06T00:01:00.000Z',
    ...overrides,
  };
}

function createFakePool() {
  const queries: Query[] = [];
  const state = {
    task: makeTask(),
    items: [] as Array<Record<string, unknown>>,
    logs: [] as Array<Record<string, unknown>>,
  };
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('INSERT INTO crawler_tasks')) {
        const plan = JSON.parse(String(params?.[5] || '{}'));
        state.task = makeTask({
          owner_id: params?.[0],
          owner_username: params?.[1],
          job_id: params?.[2],
          title: params?.[3],
          goal: params?.[4],
          crawler_plan: plan,
          max_pages: params?.[6],
          max_depth: params?.[7],
        });
        return { rows: [state.task] };
      }
      if (text.includes('INSERT INTO crawler_task_logs')) {
        state.logs.push({ task_id: params?.[0], level: params?.[1], message: params?.[2], detail: params?.[3] });
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM crawler_tasks WHERE task_id')) return { rows: [state.task] };
      if (text.includes('SELECT * FROM crawler_tasks')) return { rows: [state.task] };
      if (text.includes('UPDATE crawler_tasks') && text.includes("status = 'running'")) {
        state.task = { ...state.task, status: 'running', started_at: '2026-07-06T00:00:30.000Z' };
        return { rows: [state.task] };
      }
      if (text.includes('UPDATE crawler_tasks') && text.includes('RETURNING *')) {
        state.task = {
          ...state.task,
          status: params?.[1],
          error_message: params?.[2] ?? null,
          finished_at: '2026-07-06T00:02:00.000Z',
        };
        return { rows: [state.task] };
      }
      if (text.includes('INSERT INTO crawler_items')) {
        const item = makeItem({
          task_id: params?.[0],
          owner_id: params?.[1],
          job_id: params?.[2],
          url: params?.[3],
          title: params?.[4],
          publisher: params?.[5],
          published_at: params?.[6],
          content_text: params?.[7],
          content_summary: params?.[8],
          metadata: JSON.parse(String(params?.[9] || '{}')),
          relevance_score: params?.[10],
          credibility_score: params?.[11],
        });
        state.items.push(item);
        return { rows: [item] };
      }
      if (text.includes('SELECT * FROM crawler_items')) return { rows: state.items };
      if (text.includes('DELETE FROM crawler_tasks')) return { rows: [] };
      return { rows: [] };
    },
    end: async () => undefined,
  };
  return { pool, queries, state };
}

function createCrawlerService() {
  const fake = createFakePool();
  const service = new CrawlerService() as CrawlerService & {
    getPool: () => Promise<typeof fake.pool>;
    fetchPublicPage: (url: string) => Promise<Record<string, unknown>>;
    assertSafeUrl: (url: string) => Promise<void>;
  };
  service.getPool = async () => fake.pool;
  return { service, ...fake };
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}

async function testInternalSkillToken() {
  process.env.INTERNAL_SKILL_TOKEN = 'test-internal-token';

  @Module({
    controllers: [InternalCrawlerController],
    providers: [{ provide: CrawlerService, useValue: { assertInternalToken: (token: string) => new CrawlerService().assertInternalToken(token), createTask: async () => ({}) } }],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/internal/crawler/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-skill-token': 'wrong' },
      body: JSON.stringify({ jobId: 'job-1', ownerId: 'user-1' }),
    });
    await assertStatus(response, 401);
  } finally {
    await app.close();
  }
}

async function testCreateTaskAndSafety() {
  const { service } = createCrawlerService();
  const created = await service.createTask({
    jobId: 'job-1',
    ownerId: 'user-1',
    ownerUsername: 'operator',
    title: '采集任务',
    goal: '补充资料',
    crawlerPlan: { enabled: false, maxPages: 99, maxDepth: 9 },
  });
  assert.equal(created.maxPages, 50);
  assert.equal(created.maxDepth, 2);

  await assert.rejects(
    () => service.createTask({ jobId: 'job-1', ownerId: 'user-1', crawlerPlan: { manualUrls: ['http://localhost/a'] } }),
    (error) => /Localhost|Private network/.test(errorText(error)),
  );
  await assert.rejects(
    () => service.createTask({ jobId: 'job-1', ownerId: 'user-1', crawlerPlan: { manualUrls: ['http://127.0.0.1/a'] } }),
    (error) => /Private network/.test(errorText(error)),
  );
  await assert.rejects(
    () => service.createTask({ jobId: 'job-1', ownerId: 'user-1', crawlerPlan: { manualUrls: ['file:///etc/passwd'] } }),
    (error) => /http\/https/.test(errorText(error)),
  );
}

async function testRunTaskWritesItems() {
  const { service, state } = createCrawlerService();
  service.assertSafeUrl = async () => undefined;
  service.fetchPublicPage = async (url: string) => ({
    url,
    title: 'Example Report',
    publisher: 'example.com',
    publishedAt: null,
    contentText: 'Example content',
    contentSummary: 'Example content',
    metadata: { test: true },
  });
  const result = await service.runTask('11111111-1111-4111-8111-111111111111');
  assert.equal(result.items.length, 1);
  assert.equal(state.items.length, 1);
  assert.ok(state.logs.some((log) => String(log.message).includes('资料采集工具')));
}

async function testOwnerIsolation() {
  const { service } = createCrawlerService();
  const owner = await service.getTask('11111111-1111-4111-8111-111111111111', user('user-1', 'operator', ['crawler:read']));
  assert.equal(owner.taskId, '11111111-1111-4111-8111-111111111111');
  await assert.rejects(
    () => service.getTask('11111111-1111-4111-8111-111111111111', user('user-2', 'operator', ['crawler:read'])),
    (error) => /Insufficient crawler task permissions/.test(errorText(error)),
  );
  const admin = await service.getTask('11111111-1111-4111-8111-111111111111', user('admin-1', 'admin', ['crawler:read']));
  assert.equal(admin.jobId, 'job-1');
}

function testHermesCrawlerPlanRequirements() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    getSkillRequirements: (input: unknown) => string[];
    buildContextJsonPayload: (input: unknown) => Record<string, unknown>;
  };
  const disabledInput = {
    skill: 'write-hb',
    jobId: 'job-1',
    payload: {
      topic: '测试',
      report_type: 'K报',
      known_context: JSON.stringify({
        databaseSourceOptions: { enabled: true },
        crawlerPlan: { enabled: false },
      }),
    },
  };
  const requirements = hermes.getSkillRequirements(disabledInput).join('\n');
  assert.match(requirements, /不得调用 controlled-web-collector/);

  const contextPayload = hermes.buildContextJsonPayload({
    ...disabledInput,
    payload: {
      ...disabledInput.payload,
      known_context: JSON.stringify({
        databaseSourceOptions: { enabled: true },
        crawlerPlan: { enabled: true, manualUrls: ['https://example.com'] },
      }),
    },
  });
  const context = contextPayload.context_json as Record<string, unknown>;
  assert.ok(context.databaseSourceOptions, 'databaseSourceOptions should remain present');
  assert.deepEqual(context.crawlerSourceContext, { tasks: [], items: [] });
}

await testInternalSkillToken();
await testCreateTaskAndSafety();
await testRunTaskWritesItems();
await testOwnerIsolation();
testHermesCrawlerPlanRequirements();

console.log('crawler tests passed');
