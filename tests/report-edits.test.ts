import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { ReportsController } from '../server/reports.controller.js';
import { ReportsService } from '../server/reports.service.js';

type Query = { text: string; params?: unknown[] };

function user(id: string, role: AuthUser['role'], permissions: string[]): AuthUser {
  return { id, username: `${role}-${id}`, displayName: '', email: null, role, roles: [role], permissions };
}

function remoteFsStub() {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    readFile: async () => '{}',
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) return JSON.stringify((error as { response?: unknown }).response);
  return error instanceof Error ? error.message : String(error);
}

function makeJob(jobId: string, ownerUserId: string | null) {
  return {
    jobId,
    skill: 'write-hb',
    payload: {
      topic: '欧洲政治事件',
      report_type: 'K报',
      known_context: JSON.stringify({
        report_plan: { title: '用户确认提纲' },
        userPreferenceContext: { preferences: { writingStyle: '简洁正式' } },
      }),
    },
    ownerUserId,
    ownerUsername: ownerUserId || '',
    ownerRole: 'operator',
    status: 'succeeded',
    artifacts: {},
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    events: [],
    eventLog: [],
  };
}

async function testReportEditHttpAuthorization() {
  const usersByToken: Record<string, AuthUser> = {
    operator: user('user-1', 'operator', ['report:update']),
    viewer: user('viewer-1', 'viewer', ['report:read']),
  };

  @Module({
    controllers: [ReportsController],
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
      {
        provide: ReportsService,
        useValue: {
          createReportEdit: async () => ({ editId: 'edit-1', jobId: 'job-1', editedText: '修改后段落' }),
          listReportEdits: async () => ({ items: [] }),
          applyReportEdit: async () => ({ success: false }),
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/api/report-jobs/job-1/edits`;
  const body = JSON.stringify({ targetType: 'paragraph', originalText: '原文', instruction: '润色', editMode: 'polish' });

  try {
    await assertStatus(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), 401);
    await assertStatus(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer viewer' }, body }), 403);
    const created = await assertStatus(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator' }, body }), 201);
    assert.equal(created.editedText, '修改后段落');
  } finally {
    await app.close();
  }
}

async function testReportEditServiceOwnerAdminValidationAndInsert() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('INSERT INTO report_edits')) {
        return {
          rows: [{
            edit_id: 'edit-1',
            job_id: params?.[0],
            owner_id: params?.[1],
            target_type: params?.[2],
            target_path: params?.[3],
            original_text: params?.[4],
            instruction: params?.[5],
            edited_text: params?.[6],
            edit_mode: params?.[7],
            model_used: params?.[8],
            status: 'completed',
            created_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      if (text.includes('SELECT edit_id') && text.includes('FROM report_edits')) {
        return {
          rows: [{
            edit_id: 'edit-1',
            job_id: params?.[0],
            owner_id: 'user-1',
            target_type: 'paragraph',
            target_path: 'sections[2].paragraphs[1]',
            original_text: '原文',
            instruction: '润色',
            edited_text: '修改后段落',
            edit_mode: 'polish',
            model_used: 'test-model',
            status: 'completed',
            created_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new ReportsService({} as never, remoteFsStub() as never, { search: async () => ({ status: 'disabled', sources: [] }) } as never) as ReportsService & {
    jobs: Map<string, Record<string, unknown>>;
    getPool: () => Promise<typeof pool>;
    generateReportEditText: () => Promise<{ editedText: string; modelUsed: string }>;
  };
  service.getPool = async () => pool;
  service.generateReportEditText = async () => ({ editedText: '修改后段落', modelUsed: 'test-model' });
  service.jobs.set('job-1', makeJob('job-1', 'user-1'));
  service.jobs.set('job-2', makeJob('job-2', 'other-user'));

  await assert.rejects(
    () => service.createReportEdit('job-1', user('viewer-1', 'viewer', ['report:read']), { targetType: 'paragraph', originalText: '原文', instruction: '润色' }),
    (error) => /Insufficient report update permissions/.test(errorText(error)),
  );
  await assert.rejects(
    () => service.createReportEdit('job-2', user('user-1', 'operator', ['report:update']), { targetType: 'paragraph', originalText: '原文', instruction: '润色' }),
    (error) => /Insufficient report job permissions/.test(errorText(error)),
  );
  await assert.rejects(
    () => service.createReportEdit('job-1', user('user-1', 'operator', ['report:update']), { targetType: 'paragraph', originalText: '', instruction: '润色' }),
    (error) => /originalText is required/.test(errorText(error)),
  );
  await assert.rejects(
    () => service.createReportEdit('job-1', user('user-1', 'operator', ['report:update']), { targetType: 'paragraph', originalText: '原文', instruction: '' }),
    (error) => /instruction is required/.test(errorText(error)),
  );

  const created = await service.createReportEdit('job-1', user('user-1', 'operator', ['report:update']), {
    targetType: 'paragraph',
    targetPath: 'sections[2].paragraphs[1]',
    originalText: '原文',
    instruction: '请补充来源',
    editMode: 'add_sources',
  });
  assert.equal(created.editedText, '修改后段落');
  assert.ok(queries.some((query) => query.text.includes('INSERT INTO report_edits')));

  const adminCreated = await service.createReportEdit('job-2', user('admin-1', 'admin', ['report:update']), {
    targetType: 'section',
    originalText: '原文',
    instruction: '扩写',
    editMode: 'expand',
  });
  assert.equal(adminCreated.jobId, 'job-2');

  const history = await service.listReportEdits('job-1', user('user-1', 'operator', ['report:update']));
  assert.equal(history.items[0].editId, 'edit-1');
}

async function testReportEditDoesNotPersistCompletedEditOnLlmFailure() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new ReportsService({} as never, remoteFsStub() as never, { search: async () => ({ status: 'disabled', sources: [] }) } as never) as ReportsService & {
    jobs: Map<string, Record<string, unknown>>;
    getPool: () => Promise<typeof pool>;
    generateReportEditText: () => Promise<{ editedText: string; modelUsed: string }>;
  };
  service.getPool = async () => pool;
  service.generateReportEditText = async () => {
    throw new Error('LLM unavailable');
  };
  service.jobs.set('job-1', makeJob('job-1', 'user-1'));
  await assert.rejects(
    () => service.createReportEdit('job-1', user('user-1', 'operator', ['report:update']), { targetType: 'paragraph', originalText: '原文', instruction: '润色' }),
    (error) => /局部修改生成失败/.test(errorText(error)),
  );
  assert.equal(queries.some((query) => query.text.includes('INSERT INTO report_edits')), false);
}

await testReportEditHttpAuthorization();
await testReportEditServiceOwnerAdminValidationAndInsert();
await testReportEditDoesNotPersistCompletedEditOnLlmFailure();
console.log('report edits tests passed');
