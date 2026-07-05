import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { AuthUser } from '../server/auth-user.interface.js';
import { ReportsService } from '../server/reports.service.js';
import { UserPreferencesService } from '../server/user-preferences.service.js';

type Query = { text: string; params?: unknown[] };

function authUser(id: string, role: AuthUser['role'], permissions: string[] = []): AuthUser {
  return {
    id,
    username: `${role}-${id}`,
    displayName: '',
    email: null,
    role,
    roles: [role],
    permissions,
  };
}

function createRemoteFsStub(writes: Array<{ path: string; content: string }>) {
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

async function testDefaultPreferencesAndUpsert() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM user_preferences') && text.includes('WHERE owner_id')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO user_preferences')) {
        return {
          rows: [{
            preference_id: 'pref-1',
            owner_id: params?.[0],
            default_report_type: params?.[1],
            default_region: params?.[2],
            default_language: params?.[3],
            writing_style: params?.[4],
            tone: params?.[5],
            default_source_options: params?.[6],
            default_outline_options: params?.[7],
            preference_json: params?.[8],
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new UserPreferencesService() as UserPreferencesService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;
  const user = authUser('user-1', 'operator', ['preference:read', 'preference:update']);

  const defaults = await service.getMyPreferences(user);
  assert.equal(defaults.ownerId, 'user-1');
  assert.equal(defaults.defaultLanguage, 'zh-CN');
  assert.deepEqual(defaults.defaultSourceOptions, {});

  const updated = await service.updateMyPreferences(user, {
    defaultReportType: '综合研判',
    defaultRegion: '欧洲',
    writingStyle: '简洁、正式、情报分析风格',
    tone: '客观审慎',
    defaultSourceOptions: { databaseSourceEnabled: true, lookbackDays: 30 },
    defaultOutlineOptions: { includeTrend: true },
    preferenceJson: { focus: 'risk' },
  });
  assert.equal(updated.defaultReportType, '综合研判');
  assert.equal(updated.defaultRegion, '欧洲');
  assert.deepEqual(updated.defaultSourceOptions, { databaseSourceEnabled: true, lookbackDays: 30 });
  assert.ok(queries.some((query) => query.text.includes('ON CONFLICT (owner_id) DO UPDATE')));
}

async function testTemplateOwnerAdminIsolationAndDefaultSwitch() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('SELECT template_id') && text.includes('FROM user_report_templates') && text.includes('WHERE template_id = $1')) {
        if (params?.[0] === 'missing-template') return { rows: [] };
        return {
          rows: [{
            template_id: params?.[0],
            owner_id: params?.[0] === 'other-template' ? 'other-user' : 'user-1',
            template_name: '欧洲政治事件编报模板',
            template_type: 'daily_event_report',
            description: '适用于欧洲政治类事件',
            template_json: { sections: [] },
            is_default: true,
            is_shared: false,
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      if (text.includes('SELECT template_id') && text.includes('FROM user_report_templates') && text.includes('ORDER BY updated_at')) {
        return {
          rows: [
            {
              template_id: 'tpl-1',
              owner_id: params?.includes('other-user') ? 'other-user' : 'user-1',
              template_name: '模板1',
              template_type: 'daily_event_report',
              description: '',
              template_json: { sections: [] },
              is_default: true,
              is_shared: false,
              created_at: '2026-07-05T00:00:00.000Z',
              updated_at: '2026-07-05T00:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes('COUNT(*)') && text.includes('FROM user_report_templates')) {
        return { rows: [{ count: '1' }] };
      }
      if (text.includes('INSERT INTO user_report_templates')) {
        return {
          rows: [{
            template_id: 'tpl-created',
            owner_id: params?.[0],
            template_name: params?.[1],
            template_type: params?.[2],
            description: params?.[3],
            template_json: params?.[4],
            is_default: params?.[5],
            is_shared: params?.[6],
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      if (text.includes('UPDATE user_report_templates') && text.includes('RETURNING')) {
        return {
          rows: [{
            template_id: params?.[7],
            owner_id: 'user-1',
            template_name: params?.[0],
            template_type: params?.[1],
            description: params?.[2],
            template_json: params?.[3],
            is_default: params?.[4],
            is_shared: params?.[5],
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new UserPreferencesService() as UserPreferencesService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;

  const operator = authUser('user-1', 'operator', ['template:read', 'template:create', 'template:update', 'template:delete']);
  const admin = authUser('admin-1', 'admin', ['template:read']);

  const ownList = await service.listTemplates(operator, {});
  assert.equal(ownList.items[0].ownerId, 'user-1');

  const adminList = await service.listTemplates(admin, { ownerId: 'other-user' });
  assert.equal(adminList.items[0].ownerId, 'other-user');

  await assert.rejects(() => service.applyTemplate(operator, 'other-template'), /not found/i);
  const appliedByAdmin = await service.applyTemplate(admin, 'other-template');
  assert.equal(appliedByAdmin.templateId, 'other-template');

  const createdDefault = await service.createTemplate(operator, {
    templateName: '新默认模板',
    templateType: 'daily_event_report',
    templateJson: { sections: [] },
    isDefault: true,
  });
  assert.equal(createdDefault.isDefault, true);
  assert.ok(queries.some((query) => query.text.includes('SET is_default = false') && query.params?.[0] === 'user-1'));

  const updatedDefault = await service.updateTemplate(operator, 'tpl-1', {
    templateName: '更新默认模板',
    templateType: 'daily_event_report',
    templateJson: { sections: [{ title: '事件概况' }] },
    isDefault: true,
  });
  assert.equal(updatedDefault.isDefault, true);
  assert.ok(queries.some((query) => query.text === 'BEGIN'));
  assert.ok(queries.some((query) => query.text === 'COMMIT'));
}

async function testPromptSnippetCrud() {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('INSERT INTO user_prompt_snippets')) {
        return {
          rows: [{
            snippet_id: 'snip-1',
            owner_id: params?.[0],
            snippet_name: params?.[1],
            snippet_type: params?.[2],
            content: params?.[3],
            tags: params?.[4],
            usage_count: 0,
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      if (text.includes('SELECT snippet_id') && text.includes('FROM user_prompt_snippets')) {
        return {
          rows: [{
            snippet_id: 'snip-1',
            owner_id: 'user-1',
            snippet_name: '涉我风险',
            snippet_type: 'risk_focus',
            content: '强化涉我风险分析',
            tags: ['risk'],
            usage_count: 0,
            created_at: '2026-07-05T00:00:00.000Z',
            updated_at: '2026-07-05T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  const service = new UserPreferencesService() as UserPreferencesService & { getPool: () => Promise<typeof pool> };
  service.getPool = async () => pool;
  const user = authUser('user-1', 'viewer', ['template:create']);

  const created = await service.createPromptSnippet(user, {
    snippetName: '涉我风险',
    snippetType: 'risk_focus',
    content: '强化涉我风险分析',
    tags: ['risk'],
  });
  assert.equal(created.content, '强化涉我风险分析');
  assert.deepEqual(created.tags, ['risk']);

  const list = await service.listPromptSnippets(user, {});
  assert.equal(list.items[0].snippetId, 'snip-1');
  assert.ok(queries.some((query) => query.text.includes('owner_id = $1')));
}

async function testReportJobInjectsUserPreferenceContextOnlyWhenRequested() {
  const writes: Array<{ path: string; content: string }> = [];
  const preferenceService = {
    buildUserPreferenceContext: async (user: AuthUser, templateId?: string) => ({
      ownerId: user.id,
      preferences: { writingStyle: '简洁正式', defaultSourceOptions: { lookbackDays: 30 } },
      template: templateId ? { templateId, templateName: '欧洲政治事件编报模板', templateJson: { sections: [] } } : null,
      promptSnippets: [{ snippetId: 'snip-1', content: '强化涉我风险分析' }],
    }),
  };
  const service = new ReportsService(
    {} as never,
    createRemoteFsStub(writes) as never,
    { search: async () => ({ status: 'disabled', sources: [] }) } as never,
    preferenceService as never,
  ) as ReportsService & {
    jobs: Map<string, Record<string, unknown>>;
    runJob: (job: unknown) => Promise<void>;
    writeJobState: (job: unknown) => Promise<void>;
  };
  service.runJob = async () => undefined;
  service.writeJobState = async () => undefined;

  const user = authUser('user-1', 'operator', ['report:create']);
  const first = await service.createJob({
    skill: 'write-hb',
    payload: { topic: '普通任务', report_type: 'K', useMyPreferences: false },
  }, user);
  const firstJob = service.jobs.get(first.jobId);
  const firstPayload = firstJob?.payload as Record<string, unknown>;
  assert.equal(firstPayload.known_context, undefined);

  const second = await service.createJob({
    skill: 'write-hb',
    payload: {
      topic: '偏好任务',
      report_type: 'K',
      useMyPreferences: true,
      templateId: 'tpl-1',
      known_context: JSON.stringify({ report_plan: { title: '用户确认提纲' } }),
    },
  }, user);
  const secondJob = service.jobs.get(second.jobId);
  const secondPayload = secondJob?.payload as Record<string, unknown>;
  const context = JSON.parse(String(secondPayload.known_context || '{}'));
  assert.equal(context.report_plan.title, '用户确认提纲');
  assert.equal(context.userPreferenceContext.ownerId, 'user-1');
  assert.equal(context.userPreferenceContext.preferences.writingStyle, '简洁正式');
  assert.equal(context.userPreferenceContext.template.templateId, 'tpl-1');
  assert.equal(context.userPreferenceContext.promptSnippets[0].content, '强化涉我风险分析');
}

await testDefaultPreferencesAndUpsert();
await testTemplateOwnerAdminIsolationAndDefaultSwitch();
await testPromptSnippetCrud();
await testReportJobInjectsUserPreferenceContextOnlyWhenRequested();
console.log('user preferences tests passed');
