import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { NestFactory, Reflector } from '@nestjs/core';
import bcrypt from 'bcrypt';
import { ReportPlansController } from '../server/report-plans.controller.js';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import { RolesGuard, AUTH_ROLES_KEY } from '../server/roles.guard.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { AUTH_PERMISSIONS_KEY } from '../server/require-permissions.decorator.js';
import { ChatController } from '../server/chat.controller.js';
import { DailyAwarenessController } from '../server/daily-awareness.controller.js';
import { DraftAssistantController } from '../server/draft-assistant.controller.js';
import { ReportsController } from '../server/reports.controller.js';
import { ReportsService } from '../server/reports.service.js';
import { ResearchKeysController } from '../server/research-keys.controller.js';
import { ResearchKeysService } from '../server/research-keys.service.js';
import { UsersController } from '../server/users.controller.js';
import { UsersService } from '../server/users.service.js';
import { VectorSourcesController } from '../server/vector-sources.controller.js';
import { VectorSourceService } from '../server/vector-source.service.js';
import { HermesService } from '../server/hermes.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

type WrittenFile = { path: string; content: string };

function createRemoteFsStub(writes: WrittenFile[]) {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => {
      writes.push({ path, content });
    },
    readFile: async () => '{}',
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function createReportsService() {
  const writes: WrittenFile[] = [];
  const vectorSources = { search: async () => ({ status: 'disabled', sources: [] }) };
  const service = new ReportsService({} as never, createRemoteFsStub(writes) as never, vectorSources as never);
  return service as ReportsService & { jobs: Map<string, Record<string, unknown>> };
}

function user(id: string, role: AuthUser['role']): AuthUser {
  const rolePermissions: Record<AuthUser['role'], string[]> = {
    admin: ['report:create', 'report:delete', 'research_key:update', 'vector_source:update', 'user:manage'],
    operator: ['report:create'],
    viewer: ['report:read'],
  };
  const roleModules: Record<AuthUser['role'], string[]> = {
    admin: ['report', 'qa', 'draft', 'daily'],
    operator: ['report'],
    viewer: ['report'],
  };
  return {
    id,
    username: `${role}-${id}`,
    displayName: '',
    email: null,
    role,
    roles: [role],
    modules: roleModules[role],
    permissions: rolePermissions[role],
  };
}

function job(jobId: string, ownerUserId: string | null, ownerUsername = '') {
  return {
    jobId,
    skill: 'write-hb',
    payload: { topic: jobId, report_type: 'K' },
    ownerUserId,
    ownerUsername,
    status: 'succeeded',
    artifacts: {},
    createdAt: `2026-07-05T00:00:0${jobId.slice(-1)}.000Z`,
    updatedAt: `2026-07-05T00:00:0${jobId.slice(-1)}.000Z`,
    events: [],
    eventLog: [],
  };
}

function itemIds(result: Awaited<ReturnType<ReportsService['listJobs']>>) {
  return result.items.map((item) => item.jobId).sort();
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
}

function testReportPlansRequireAdminOrOperator() {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ReportPlansController) || [];
  assert.ok(guards.includes(AuthGuard), 'ReportPlansController should use AuthGuard');
  assert.ok(guards.includes(PermissionsGuard), 'ReportPlansController should use PermissionsGuard');

  const classPermissions = Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportPlansController) || [];
  const createPermissions = Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportPlansController.prototype.create) || classPermissions;
  assert.deepEqual(createPermissions, ['report:create']);
}

function testHighRiskEndpointsDeclarePermissions() {
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.create), ['report:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.list), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.get), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.cancel), ['report:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.delete), ['report:delete']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.listReportEdits), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.restore), ['report:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.permanentDelete), ['report:delete']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.progress), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.eventLog), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.events), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.result), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.databaseSources), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.sources), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ReportsController.prototype.download), ['report:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ResearchKeysController.prototype.update), ['research_key:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, VectorSourcesController.prototype.switchProfile), ['vector_source:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, VectorSourcesController.prototype.reindex), ['vector_source:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, UsersController), ['user:manage']);
}

function testModuleControllersDeclarePermissions() {
  const chatGuards = Reflect.getMetadata(GUARDS_METADATA, ChatController) || [];
  assert.ok(chatGuards.includes(AuthGuard), 'ChatController should use AuthGuard');
  assert.ok(chatGuards.includes(PermissionsGuard), 'ChatController should use PermissionsGuard');
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ChatController.prototype.completions), ['chat:execute']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ChatController.prototype.stream), ['chat:execute']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ChatController.prototype.sources), ['chat:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, ChatController.prototype.upsertSources), ['chat:execute']);

  const draftGuards = Reflect.getMetadata(GUARDS_METADATA, DraftAssistantController) || [];
  assert.ok(draftGuards.includes(AuthGuard), 'DraftAssistantController should use AuthGuard');
  assert.ok(draftGuards.includes(PermissionsGuard), 'DraftAssistantController should use PermissionsGuard');
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.analyze), ['draft_assistant:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.listEvents), ['draft_assistant:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.getEvent), ['draft_assistant:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.generateOutline), ['draft_assistant:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.refineOutline), ['draft_assistant:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.manualUpdateOutline), ['draft_assistant:update']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.importOutline), ['draft_assistant:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.getOutline), ['draft_assistant:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DraftAssistantController.prototype.listOutlines), ['draft_assistant:read']);

  const dailyGuards = Reflect.getMetadata(GUARDS_METADATA, DailyAwarenessController) || [];
  assert.ok(dailyGuards.includes(AuthGuard), 'DailyAwarenessController should use AuthGuard');
  assert.ok(dailyGuards.includes(PermissionsGuard), 'DailyAwarenessController should use PermissionsGuard');
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.generate), ['daily_awareness:create']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.listBriefs), ['daily_awareness:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.getBrief), ['daily_awareness:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.downloadBrief), ['daily_awareness:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.listEvents), ['daily_awareness:read']);
  assert.deepEqual(Reflect.getMetadata(AUTH_PERMISSIONS_KEY, DailyAwarenessController.prototype.importDraft), ['daily_awareness:import']);
}

async function testReportPlansHttpAuthorization() {
  const usersByToken: Record<string, AuthUser> = {
    admin: user('admin-1', 'admin'),
    operator: user('operator-1', 'operator'),
    viewer: user('viewer-1', 'viewer'),
  };

  @Module({
    controllers: [ReportPlansController],
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
      {
        provide: AuthGuard,
        useFactory: (auth: AuthService) => new AuthGuard(auth),
        inject: [AuthService],
      },
      {
        provide: RolesGuard,
        useFactory: (reflector: Reflector) => new RolesGuard(reflector),
        inject: [Reflector],
      },
      {
        provide: PermissionsGuard,
        useFactory: (reflector: Reflector) => new PermissionsGuard(reflector),
        inject: [Reflector],
      },
      {
        provide: HermesService,
        useValue: {
          planReport: async () => ({ plan: 'ok' }),
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/api/report-plans`;
  const body = JSON.stringify({ topic: '权限测试', reportType: 'K报' });

  try {
    const unauthenticated = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    await assertStatus(unauthenticated, 401);

    const viewer = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer viewer' },
      body,
    });
    await assertStatus(viewer, 403);

    const operator = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator' },
      body,
    });
    await assertStatus(operator, 201);

    const admin = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
      body,
    });
    await assertStatus(admin, 201);
  } finally {
    await app.close();
  }
}

async function testPermissionProtectedHttpEndpoints() {
  const usersByToken: Record<string, AuthUser> = {
    admin: user('admin-1', 'admin'),
    operator: user('operator-1', 'operator'),
    viewer: user('viewer-1', 'viewer'),
  };

  @Module({
    controllers: [ReportsController, ResearchKeysController, VectorSourcesController, UsersController],
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
      {
        provide: AuthGuard,
        useFactory: (auth: AuthService) => new AuthGuard(auth),
        inject: [AuthService],
      },
      {
        provide: RolesGuard,
        useFactory: (reflector: Reflector) => new RolesGuard(reflector),
        inject: [Reflector],
      },
      {
        provide: PermissionsGuard,
        useFactory: (reflector: Reflector) => new PermissionsGuard(reflector),
        inject: [Reflector],
      },
      {
        provide: ReportsService,
        useValue: {
          createJob: async () => ({ jobId: 'job-1', status: 'queued' }),
          deleteJob: async () => job('job-1', 'admin-1', 'admin'),
          serializeJob: (value: unknown) => value,
        },
      },
      {
        provide: ResearchKeysService,
        useValue: {
          getStatus: () => ({ configured: false }),
          updateKeys: () => ({ ok: true }),
        },
      },
      {
        provide: VectorSourceService,
        useValue: {
          status: () => ({ ok: true }),
          profiles: () => ({ items: [] }),
          switchProfile: () => ({ ok: true }),
          reindex: () => ({ ok: true }),
        },
      },
      {
        provide: UsersService,
        useValue: {
          listUsers: () => [],
          createUser: (body: unknown) => body,
          updateUser: (_id: string, body: unknown) => body,
          resetPassword: () => ({ ok: true }),
          disableUser: () => ({ ok: true }),
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
  const reportBody = JSON.stringify({ skill: 'write-hb', payload: { topic: '权限测试' } });

  try {
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer viewer' },
      body: reportBody,
    }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator' },
      body: reportBody,
    }), 201);
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs/job-1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer operator' },
    }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/report-jobs/job-1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin' },
    }), 200);
    await assertStatus(await fetch(`${baseUrl}/api/research-keys`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator' },
      body: '{}',
    }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/research-keys`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
      body: '{}',
    }), 200);
    await assertStatus(await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: 'Bearer viewer' },
    }), 403);
    await assertStatus(await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: 'Bearer admin' },
    }), 200);
  } finally {
    await app.close();
  }
}

async function testAuthServiceReturnsRbacAccess() {
  const passwordHash = await bcrypt.hash('password123', 4);
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM users') && params?.[0] === 'admin') {
        return { rows: [{
          id: 'admin-1',
          username: 'admin',
          password_hash: passwordHash,
          display_name: 'Admin',
          email: null,
          role: 'admin',
          is_active: true,
        }] };
      }
      if (text.includes('FROM users') && params?.[0] === 'operator') {
        return { rows: [{
          id: 'operator-1',
          username: 'operator',
          password_hash: passwordHash,
          display_name: 'Operator',
          email: null,
          role: 'operator',
          is_active: true,
        }] };
      }
      if (text.includes('FROM user_roles') && params?.[0] === 'admin-1') {
        return { rows: [
          { role_name: 'admin', resource: 'report', action: 'delete' },
          { role_name: 'admin', resource: 'research_key', action: 'update' },
        ] };
      }
      if (text.includes('FROM user_roles') && params?.[0] === 'operator-1') {
        return { rows: [] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new AuthService() as AuthService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;

  const adminLogin = await service.login('admin', 'password123');
  assert.deepEqual(adminLogin.user.roles, ['admin']);
  assert.ok(adminLogin.user.permissions.includes('report:delete'));
  assert.ok(adminLogin.user.permissions.includes('research_key:update'));

  const operatorLogin = await service.login('operator', 'password123');
  assert.deepEqual(operatorLogin.user.roles, ['operator']);
  assert.ok(operatorLogin.user.permissions.includes('report:create'));
  assert.ok(!operatorLogin.user.permissions.includes('report:delete'));
  assert.ok(queries.some((query) => query.text.includes('FROM user_roles')));
}

async function testReportJobListVisibility() {
  const service = createReportsService();
  service.jobs.set('admin-owned', job('admin-owned', 'admin-1', 'admin'));
  service.jobs.set('operator-owned', job('operator-owned', 'operator-1', 'operator'));
  service.jobs.set('viewer-owned', job('viewer-owned', 'viewer-1', 'viewer'));
  service.jobs.set('legacy-no-owner', job('legacy-no-owner', null, ''));

  assert.deepEqual(
    itemIds(await service.listJobs({}, user('admin-1', 'admin'))),
    ['admin-owned', 'legacy-no-owner', 'operator-owned', 'viewer-owned'],
  );
  assert.deepEqual(
    itemIds(await service.listJobs({ mine: 'true' }, user('admin-1', 'admin'))),
    ['admin-owned'],
  );
  assert.deepEqual(
    itemIds(await service.listJobs({}, user('operator-1', 'operator'))),
    ['operator-owned'],
  );
  assert.deepEqual(
    itemIds(await service.listJobs({}, user('viewer-1', 'viewer'))),
    ['viewer-owned'],
  );
}

testReportPlansRequireAdminOrOperator();
testHighRiskEndpointsDeclarePermissions();
testModuleControllersDeclarePermissions();
await testReportPlansHttpAuthorization();
await testPermissionProtectedHttpEndpoints();
await testAuthServiceReturnsRbacAccess();
await testReportJobListVisibility();
console.log('account permission tests passed');
