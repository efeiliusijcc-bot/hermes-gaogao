import 'reflect-metadata';
import assert from 'node:assert/strict';
import { HermesService } from '../server/hermes.service.js';
import { ReportsService } from '../server/reports.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

const legacyFields = [
  'planningCollection',
  'planning_collection',
  'planningCollectionStatus',
  'selectedCrawlerItemIds',
  'selectedPlanningSources',
  'planningCollectionTaskId',
  'collectionTasks',
  'collectionDiagnostics',
  'planningCoverage',
  'crawlerTaskIds',
  'crawlerPlan',
  'crawlerSourceContext',
  'allowFurtherCollectionInResearch',
  'autoGapFilling',
  'collectionMode',
  'planningSessionId',
] as const;

function remoteFsStub() {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => { writes.push({ path, content }); },
    readFile: async () => { throw new Error('missing'); },
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function user(): AuthUser {
  return {
    id: 'user-1', username: 'operator-1', displayName: '', email: null, role: 'operator', roles: ['operator'],
    modules: ['report'], permissions: ['report:create', 'report:read'],
  };
}

function legacyContext() {
  return {
    topic: '保留主题',
    selectedSources: [{ id: 'public_news' }],
    selectedModules: [{ id: 'basic' }],
    userProvidedSources: ['https://example.com/manual'],
    databaseSourceOptions: { enabled: true },
    webSearchOptions: { enabled: true },
    freeTextContext: '保留普通文本',
    ...Object.fromEntries(legacyFields.map((field) => [field, { legacy: true }])),
  };
}

function assertLegacyFieldsRemoved(value: Record<string, unknown>) {
  for (const field of legacyFields) assert.equal(value[field], undefined, `legacy field remains: ${field}`);
}

async function testNewAndHistoricalPayloadsAreSanitized() {
  const remoteFs = remoteFsStub();
  const service = new ReportsService({} as never, remoteFs as never, {} as never) as ReportsService & {
    jobs: Map<string, Record<string, unknown>>;
    contextObjectFromPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  };
  const context = legacyContext();
  const rootLegacy = Object.fromEntries(legacyFields.map((field) => [field, 'legacy-root']));
  const previousSetImmediate = globalThis.setImmediate;
  globalThis.setImmediate = (() => ({}) as NodeJS.Immediate) as typeof setImmediate;
  try {
    const created = await service.createJob({
      skill: 'write-hb',
      payload: {
        topic: '保留主题',
        known_context: JSON.stringify(context),
        ...rootLegacy,
      } as never,
    }, user());
    const stored = service.jobs.get(created.jobId)!;
    const storedPayload = stored.payload as Record<string, unknown>;
    assertLegacyFieldsRemoved(storedPayload);
    const storedContext = JSON.parse(String(storedPayload.known_context));
    assertLegacyFieldsRemoved(storedContext);
    assert.deepEqual(storedContext.userProvidedSources, context.userProvidedSources);
    assert.deepEqual(storedContext.selectedSources, context.selectedSources);
    assert.deepEqual(storedContext.selectedModules, context.selectedModules);

    const historical = {
      ...stored,
      payload: { ...storedPayload, ...rootLegacy, known_context: JSON.stringify(context) },
    };
    const serialized = service.serializeJob(historical as never);
    const serializedPayload = serialized.payload as unknown as Record<string, unknown>;
    assertLegacyFieldsRemoved(serializedPayload);
    assertLegacyFieldsRemoved(JSON.parse(String(serializedPayload.known_context)));

    const parsed = service.contextObjectFromPayload({ known_context: JSON.stringify(context) });
    assertLegacyFieldsRemoved(parsed);
    assert.equal(parsed.freeTextContext, '保留普通文本');
  } finally {
    globalThis.setImmediate = previousSetImmediate;
  }
}

function testFreeTextContextIsPreserved() {
  const service = new ReportsService({} as never, remoteFsStub() as never, {} as never) as ReportsService & {
    contextObjectFromPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  };
  const parsed = service.contextObjectFromPayload({ topic: '主题', known_context: '普通文本 context' });
  assert.equal(parsed.freeTextContext, '普通文本 context');
}

function testHermesIgnoresLegacyPlanningFields() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    buildContextJsonPayload: (input: Record<string, unknown>) => Record<string, unknown>;
    buildReportPrompt: (input: Record<string, unknown>) => string;
    getSkillRequirements: (input: Record<string, unknown>) => string[];
  };
  const input = {
    skill: 'write-hb',
    jobId: 'job-legacy-context',
    payload: {
      topic: '保留主题',
      report_type: 'K报',
      known_context: JSON.stringify(legacyContext()),
      crawlerPlan: { enabled: true },
    },
  };
  const built = hermes.buildContextJsonPayload(input);
  const contextJson = built.context_json as Record<string, unknown>;
  assertLegacyFieldsRemoved(contextJson);
  assert.deepEqual(contextJson.userProvidedSources, ['https://example.com/manual']);

  const prompt = hermes.buildReportPrompt(input);
  const requirements = hermes.getSkillRequirements(input).join('\n');
  for (const legacyText of ['crawlerPlan', 'crawlerSourceContext', 'selectedCrawlerItemIds', '规划页面已选择', 'controlled-web-collector']) {
    assert.doesNotMatch(prompt, new RegExp(legacyText));
    assert.doesNotMatch(requirements, new RegExp(legacyText));
  }
}

await testNewAndHistoricalPayloadsAreSanitized();
testFreeTextContextIsPreserved();
testHermesIgnoresLegacyPlanningFields();
console.log('legacy planning payload tests passed');
