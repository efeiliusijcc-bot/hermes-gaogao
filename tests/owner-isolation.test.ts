import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';
import { ChatController } from '../server/chat.controller.js';
import { ChatService } from '../server/chat.service.js';
import { DailyAwarenessController } from '../server/daily-awareness.controller.js';
import { DailyAwarenessService } from '../server/daily-awareness.service.js';
import { DraftAssistantController } from '../server/draft-assistant.controller.js';
import { DraftAssistantService } from '../server/draft-assistant.service.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { QaSessionSourcesService } from '../server/qa-session-sources.service.js';
import { ReportsController } from '../server/reports.controller.js';
import { ReportsService } from '../server/reports.service.js';
import { RolesGuard } from '../server/roles.guard.js';

type Query = { text: string; params?: unknown[] };
type Pool = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> };

function authUser(id: string, role: AuthUser['role'], permissions: string[] = [], modules: string[] = []): AuthUser {
  return {
    id,
    username: `${role}-${id}`,
    displayName: '',
    email: null,
    role,
    roles: [role],
    modules,
    permissions,
  };
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) return JSON.stringify((error as { response?: unknown }).response);
  return error instanceof Error ? error.message : String(error);
}

function createRemoteFsStub(files: Record<string, string> = {}) {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => {
      files[path] = content;
    },
    readFile: async (path: string) => files[path] ?? '# report',
    exists: async (path: string) => Object.prototype.hasOwnProperty.call(files, path),
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function makeJob(jobId: string, ownerUserId: string | null, resultPath = '') {
  return {
    jobId,
    skill: 'write-hb',
    payload: { topic: jobId, report_type: 'K' },
    ownerUserId,
    ownerUsername: ownerUserId ? `user-${ownerUserId}` : null,
    ownerRole: 'operator',
    status: 'succeeded',
    artifacts: {},
    resultPath,
    markdown: '# report',
    createdAt: `2026-07-06T00:00:0${jobId.slice(-1)}.000Z`,
    updatedAt: `2026-07-06T00:00:0${jobId.slice(-1)}.000Z`,
    events: [],
    eventLog: [],
  };
}

function itemIds(result: Awaited<ReturnType<ReportsService['listJobs']>>) {
  return result.items.map((item) => item.jobId).sort();
}

function createReportsService() {
  const service = new ReportsService({} as never, createRemoteFsStub({ '/tmp/hermes-reports/job-a.md': '# A' }) as never, {} as never) as ReportsService & {
    jobs: Map<string, ReturnType<typeof makeJob>>;
  };
  service.jobs.set('job-a', makeJob('job-a', 'user-a', '/tmp/hermes-reports/job-a.md'));
  service.jobs.set('job-b', makeJob('job-b', 'user-b', '/tmp/hermes-reports/job-b.md'));
  service.jobs.set('legacy-no-owner', makeJob('legacy-no-owner', null, '/tmp/hermes-reports/legacy.md'));
  return service;
}

async function testReportOwnerIsolation() {
  const service = createReportsService();
  const userA = authUser('user-a', 'operator', ['report:read'], ['report']);
  const userB = authUser('user-b', 'operator', ['report:read'], ['report']);
  const admin = authUser('admin-1', 'admin', ['report:read', 'report:delete'], ['report']);

  assert.deepEqual(itemIds(await service.listJobs({}, userA)), ['job-a']);
  assert.deepEqual(itemIds(await service.listJobs({}, userB)), ['job-b']);
  assert.deepEqual(itemIds(await service.listJobs({}, admin)), ['job-a', 'job-b', 'legacy-no-owner']);
  assert.deepEqual(itemIds(await service.listJobs({ mine: 'true' }, admin)), []);

  assert.equal((await service.getJobWithRecoveredReport('job-a', userA))?.jobId, 'job-a');
  assert.throws(
    () => service.getJob('job-b', userA),
    (error) => /Insufficient report job permissions/.test(errorText(error)),
  );
  assert.throws(
    () => service.getJob('legacy-no-owner', userA),
    (error) => /Insufficient report job permissions/.test(errorText(error)),
  );
  assert.equal((await service.getJobWithRecoveredReport('legacy-no-owner', admin))?.jobId, 'legacy-no-owner');

  const result = await service.getResultFromDisk('job-a', userA);
  assert.ok(result?.html.includes('<h1>'));
  const ownerDownload = await service.getMarkdownFromDisk('job-a', userA);
  assert.equal(ownerDownload?.markdown, '# A');
  await assert.rejects(
    () => service.getMarkdownFromDisk('job-b', userA),
    (error) => /Insufficient report job permissions/.test(errorText(error)),
  );
  const adminDownload = await service.getMarkdownFromDisk('job-b', admin);
  assert.equal(adminDownload?.markdown, '# report');
}

function createQaPool(ownerRows: Record<string, Record<string, unknown> | null>): Pool & { queries: Query[] } {
  const queries: Query[] = [];
  return {
    queries,
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM chat_sessions') && text.includes('ORDER BY updated_at DESC')) {
        const rows = Object.values(ownerRows).filter((row): row is Record<string, unknown> => Boolean(row));
        const owner = params?.[0] ? String(params[0]) : '';
        return { rows: owner ? rows.filter((row) => String(row.owner_id) === owner) : rows };
      }
      if (text.includes('FROM chat_sessions')) {
        const sessionId = String(params?.[0] || '');
        const row = ownerRows[sessionId];
        return { rows: row ? [row] : [] };
      }
      if (text.includes('UPDATE chat_sessions')) return { rows: [] };
      if (text.includes('INSERT INTO chat_sessions')) return { rows: [] };
      return { rows: [] };
    },
    end: async () => undefined,
  };
}

async function testQaSessionOwnerIsolation() {
  const remoteFs = {
    ...createRemoteFsStub(),
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    exists: async (path: string) => path.endsWith('/user-a/session-a/sources.json'),
    readFile: async (path: string) => {
      if (path.endsWith('/user-a/session-a/sources.json')) {
        return JSON.stringify({ sessionId: 'session-a', sources: [{ title: 'A' }], updatedAt: '2026-07-06T00:00:00Z' });
      }
      return '{}';
    },
  };
  const service = new QaSessionSourcesService(remoteFs as never) as QaSessionSourcesService & { getPool: () => Promise<Pool> };
  const pool = createQaPool({
    'session-a': { session_id: 'session-a', owner_id: 'user-a', owner_username: 'operator-a' },
    'session-b': { session_id: 'session-b', owner_id: 'user-b', owner_username: 'operator-b' },
  });
  service.getPool = async () => pool;

  const userA = authUser('user-a', 'operator', ['chat:read'], ['qa']);
  const admin = authUser('admin-1', 'admin', ['chat:read'], ['qa']);
  assert.deepEqual((await service.listSessions(userA)).items.map((item) => item.sessionId), ['session-a']);
  assert.deepEqual((await service.listSessions(admin)).items.map((item) => item.sessionId).sort(), ['session-a', 'session-b']);
  assert.equal((await service.getSources('session-a', userA)).sourceCount, 1);
  await assert.rejects(
    () => service.getSources('session-b', userA),
    (error) => /Insufficient chat session permissions/.test(errorText(error)),
  );
  assert.equal((await service.assertCanAccessSession('session-b', admin))?.ownerUserId, 'user-b');
}

function makeDraftEvent(ownerId: string, eventId = `event-${ownerId}`) {
  return {
    event_id: eventId,
    owner_id: ownerId,
    title: `Event ${ownerId}`,
    summary: `Summary ${ownerId}`,
    basic_facts: [],
    timeline: [],
    actors: [],
    category: '测试',
    region: '全球',
    importance_score: 60,
    risk_score: 30,
    raw_input: {},
    analysis_json: {},
    created_at: '2026-07-06T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
    owner_username: `operator-${ownerId}`,
  };
}

function createDraftPool(): Pool {
  const events = [makeDraftEvent('user-a', 'event-a'), makeDraftEvent('user-b', 'event-b')];
  return {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes('count(*)::int AS count FROM events')) {
        const owner = params?.[0] ? String(params[0]) : '';
        return { rows: [{ count: owner ? events.filter((event) => event.owner_id === owner).length : events.length }] };
      }
      if (text.includes('FROM events e') && text.includes('ORDER BY e.created_at')) {
        const owner = params?.[0] && String(params[0]).startsWith('user-') ? String(params[0]) : '';
        return { rows: owner ? events.filter((event) => event.owner_id === owner) : events };
      }
      if (text.includes('FROM events e') && text.includes('WHERE e.event_id = $1')) {
        return { rows: events.filter((event) => event.event_id === params?.[0]) };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
}

async function testDraftOwnerIsolation() {
  const service = new DraftAssistantService({} as never) as DraftAssistantService & {
    getPool: () => Promise<Pool>;
    listSources: (eventId: string) => Promise<unknown[]>;
    listAttitudes: (eventId: string) => Promise<unknown[]>;
    listOutlines: (eventId: string, user: AuthUser) => Promise<unknown[]>;
  };
  service.getPool = async () => createDraftPool();
  service.listSources = async () => [];
  service.listAttitudes = async () => [];
  service.listOutlines = async () => [];

  const userA = authUser('user-a', 'operator', ['draft_assistant:read'], ['draft']);
  const admin = authUser('admin-1', 'admin', ['draft_assistant:read'], ['draft']);
  const aList = await service.listEvents(userA);
  assert.deepEqual(aList.items.map((item) => item.eventId), ['event-a']);
  assert.equal((await service.listEvents(admin)).items.length, 2);
  await assert.rejects(
    () => service.getEvent('event-b', userA),
    (error) => /Event not found/.test(errorText(error)),
  );
  assert.equal((await service.getEvent('event-b', admin)).event.eventId, 'event-b');
}

function makeBrief(ownerId: string | null, briefId = `brief-${ownerId || 'legacy'}`) {
  return {
    brief_id: briefId,
    owner_id: ownerId,
    brief_date: '2026-07-06',
    title: `Brief ${ownerId}`,
    summary: `Summary ${ownerId}`,
    status: 'completed',
    total_candidates: 10,
    selected_count: 2,
    categories: ['测试'],
    content_json: { events: [] },
    created_at: '2026-07-06T00:00:00.000Z',
    owner_username: ownerId ? `operator-${ownerId}` : '',
  };
}

function makeDailyEvent(ownerId: string, briefId: string, itemId = `item-${ownerId}`) {
  return {
    item_id: itemId,
    brief_id: briefId,
    owner_id: ownerId,
    rank_no: 1,
    event_title: `Daily ${ownerId}`,
    category: '测试',
    region: '全球',
    basic_situation: 'basic',
    background_context: 'background',
    importance_judgement: 'important',
    risk_to_us: 'risk',
    source_info: [],
    related_material_ids: [],
    importance_score: 50,
    risk_score: 20,
    created_at: '2026-07-06T00:00:00.000Z',
  };
}

function createDailyPool(): Pool {
  const briefs = [makeBrief('user-a', 'brief-a'), makeBrief('user-b', 'brief-b'), makeBrief(null, 'brief-legacy')];
  const events = [makeDailyEvent('user-a', 'brief-a'), makeDailyEvent('user-b', 'brief-b')];
  return {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes('count(*)::int AS count FROM daily_briefs')) {
        const owner = params?.[0] && String(params[0]).startsWith('user-') ? String(params[0]) : '';
        return { rows: [{ count: owner ? briefs.filter((brief) => brief.owner_id === owner).length : briefs.length }] };
      }
      if (text.includes('FROM daily_briefs b') && text.includes('ORDER BY b.created_at')) {
        const owner = params?.[0] && String(params[0]).startsWith('user-') ? String(params[0]) : '';
        return { rows: owner ? briefs.filter((brief) => brief.owner_id === owner) : briefs };
      }
      if (text.includes('FROM daily_briefs b') && text.includes('WHERE b.brief_id = $1')) {
        return { rows: briefs.filter((brief) => brief.brief_id === params?.[0]) };
      }
      if (text.includes('count(*)::int AS count FROM daily_brief_events')) {
        const briefId = String(params?.[0] || '');
        const owner = params?.[1] && String(params[1]).startsWith('user-') ? String(params[1]) : '';
        return { rows: [{ count: events.filter((event) => event.brief_id === briefId && (!owner || event.owner_id === owner)).length }] };
      }
      if (text.includes('FROM daily_brief_events') && text.includes('ORDER BY rank_no')) {
        const briefId = String(params?.[0] || '');
        const owner = params?.[1] && String(params[1]).startsWith('user-') ? String(params[1]) : '';
        return { rows: events.filter((event) => event.brief_id === briefId && (!owner || event.owner_id === owner)) };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
}

async function testDailyOwnerIsolation() {
  const service = new DailyAwarenessService({} as never) as DailyAwarenessService & { getPool: () => Promise<Pool> };
  service.getPool = async () => createDailyPool();
  const userA = authUser('user-a', 'operator', ['daily-awareness:view'], ['daily']);
  const admin = authUser('admin-1', 'admin', ['daily-awareness:view', 'system:daily-awareness:manage'], ['daily']);

  assert.deepEqual((await service.listBriefs({}, userA)).items.map((item) => item.briefId), ['brief-a']);
  assert.equal((await service.listBriefs({}, admin)).items.length, 3);
  await assert.rejects(
    () => service.getBrief('brief-b', userA),
    (error) => /No permission to access this daily brief/.test(errorText(error)),
  );
  assert.equal((await service.getBrief('brief-b', admin)).brief.briefId, 'brief-b');
  assert.equal((await service.getBrief('brief-legacy', admin)).brief.briefId, 'brief-legacy');
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}

async function testMissingModulePermissionReturns403() {
  const usersByToken: Record<string, AuthUser> = {
    noModule: authUser('user-a', 'operator', [], []),
    report: authUser('user-a', 'operator', ['report:create', 'report:read'], ['report']),
    qa: authUser('user-a', 'operator', ['chat:execute', 'chat:read'], ['qa']),
    draft: authUser('user-a', 'operator', ['draft_assistant:create', 'draft_assistant:read'], ['draft']),
    daily: authUser('user-a', 'operator', ['daily-awareness:view', 'system:daily-awareness:manage', 'draft_assistant:create'], ['daily']),
  };

  @Module({
    controllers: [ReportsController, ChatController, DraftAssistantController, DailyAwarenessController],
    providers: [
      Reflector,
      {
        provide: AuthService,
        useValue: {
          verifyAccessToken: async (token: string) => {
            const found = usersByToken[token];
            if (!found) throw new Error('invalid token');
            return found;
          },
        },
      },
      { provide: AuthGuard, useFactory: (auth: AuthService) => new AuthGuard(auth), inject: [AuthService] },
      { provide: PermissionsGuard, useFactory: (reflector: Reflector) => new PermissionsGuard(reflector), inject: [Reflector] },
      { provide: RolesGuard, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] },
      {
        provide: ReportsService,
        useValue: {
          createJob: async () => ({ jobId: 'job-a', status: 'queued' }),
          listJobs: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, statusCounts: { succeeded: 0, running: 0 } }),
        },
      },
      {
        provide: ChatService,
        useValue: {
          complete: async () => ({ sessionId: 'session-a', choices: [] }),
        },
      },
      {
        provide: QaSessionSourcesService,
        useValue: {
          listSessions: async () => ({ items: [] }),
          getSources: async () => ({ sessionId: 'session-a', updatedAt: null, sourceCount: 0, sources: [] }),
          upsertSources: async () => ({ sessionId: 'session-a', updatedAt: null, sourceCount: 0, sources: [] }),
        },
      },
      {
        provide: DraftAssistantService,
        useValue: {
          analyze: async () => ({ eventId: 'event-a', analysis: {}, sources: [] }),
        },
      },
      {
        provide: DailyAwarenessService,
        useValue: {
          generate: async () => ({ brief: { briefId: 'brief-a' }, events: [] }),
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const reportBody = JSON.stringify({ skill: 'write-hb', payload: { topic: 'test' } });
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer noModule' }, body: reportBody }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs`, { headers: { Authorization: 'Bearer noModule' } }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer report' }, body: reportBody }), 201);

    const chatBody = JSON.stringify({ messages: [{ role: 'user', content: 'test' }] });
    await assertStatus(await fetch(`${baseUrl}/api/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer noModule' }, body: chatBody }), 403);

    const draftBody = JSON.stringify({ title: '事件', materials: '材料' });
    await assertStatus(await fetch(`${baseUrl}/api/draft-assistant/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer noModule' }, body: draftBody }), 403);

    const dailyBody = JSON.stringify({ date: '2026-07-06' });
    await assertStatus(await fetch(`${baseUrl}/api/daily-awareness/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer noModule' }, body: dailyBody }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/daily-awareness/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer daily' }, body: dailyBody }), 202);

  } finally {
    await app.close();
  }
}

await testReportOwnerIsolation();
await testQaSessionOwnerIsolation();
await testDraftOwnerIsolation();
await testDailyOwnerIsolation();
await testMissingModulePermissionReturns403();

console.log('owner isolation tests passed');
