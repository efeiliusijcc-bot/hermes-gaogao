import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

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

function createService(vectorSearchCalls: Record<string, unknown>[], writes: WrittenFile[]) {
  const vectorSources = {
    search: async (input: Record<string, unknown>) => {
      vectorSearchCalls.push(input);
      return {
        status: 'hit',
        totalHits: 1,
        sources: [{
          title: '英国拟加强未成年人社交媒体监管',
          url: 'https://example.com/source',
          summary: '测试信源摘要',
          contentExcerpt: '测试正文片段',
          websiteName: 'Example News',
          publishTime: '2026-07-04',
          similarity: 0.88,
          relevanceScore: 0.91,
        }],
        queryPlan: {
          storageMode: 'pgvector_single_table',
          sourceTable: 'vector_materials_text_embedding_v4',
          activeTable: 'vector_materials_text_embedding_v4',
          indexTable: '',
          embeddingModel: 'test-embedding',
          embeddingDimensions: 1024,
          indexedRows: 10,
          vectorHits: 1,
          keywordBoostedHits: 0,
          broadeningApplied: false,
          fallbackReason: '',
        },
      };
    },
  };
  return new ReportsService({} as never, createRemoteFsStub(writes) as never, vectorSources as never) as unknown as {
    enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

async function testDraftAssistantImportDefaultsToPgVectorRecall() {
  const writes: WrittenFile[] = [];
  const vectorSearchCalls: Record<string, unknown>[] = [];
  const service = createService(vectorSearchCalls, writes);
  const job = {
    jobId: 'draft-job',
    skill: 'write-hb',
    payload: {
      topic: '英国拟禁止16岁以下使用高风险社交媒体',
      known_context: JSON.stringify({
        kind: 'draft_assistant_import',
        topic: '英国拟禁止16岁以下使用高风险社交媒体',
        reportType: 'K报',
        draftAssistantMode: true,
        planId: 'plan-1',
      }),
    },
    artifacts: {},
    status: 'running',
    events: [],
    eventLog: [],
  };

  const result = await service.enrichPayloadWithVectorSources(job);
  const context = JSON.parse(String(result.known_context));

  assert.equal(vectorSearchCalls.length, 1);
  assert.equal(context.databaseSourceOptions.enabled, true);
  assert.equal(context.databaseSourceOptions.lookbackDays, 30);
  assert.equal(context.databaseSourceOptions.maxMetadataRows, 50);
  assert.equal(context.databaseSourceOptions.maxContentRows, 8);
  assert.ok(writes.some((item) => item.path.endsWith('/database/vector_sources.json')));
  assert.ok(writes.some((item) => item.path.endsWith('/database/database_sources.json')));
  assert.ok(writes.some((item) => item.path.endsWith('/database/database_query_plan.json')));
}

async function testExistingDatabaseSourceOptionsAreNotOverwritten() {
  const writes: WrittenFile[] = [];
  const vectorSearchCalls: Record<string, unknown>[] = [];
  const service = createService(vectorSearchCalls, writes);
  const job = {
    jobId: 'draft-job-custom',
    skill: 'write-hb',
    payload: {
      topic: '测试主题',
      known_context: JSON.stringify({
        kind: 'draft_assistant_import',
        topic: '测试主题',
        planId: 'plan-2',
        databaseSourceOptions: {
          enabled: true,
          lookbackDays: 7,
          maxMetadataRows: 12,
          maxContentRows: 3,
          sourceTable: 'custom_table',
        },
      }),
    },
    artifacts: {},
    status: 'running',
    events: [],
    eventLog: [],
  };

  const result = await service.enrichPayloadWithVectorSources(job);
  const context = JSON.parse(String(result.known_context));

  assert.equal(vectorSearchCalls.length, 1);
  assert.equal(context.databaseSourceOptions.lookbackDays, 7);
  assert.equal(context.databaseSourceOptions.maxMetadataRows, 12);
  assert.equal(context.databaseSourceOptions.maxContentRows, 3);
  assert.equal(context.databaseSourceOptions.sourceTable, 'custom_table');
}

await testDraftAssistantImportDefaultsToPgVectorRecall();
await testExistingDatabaseSourceOptionsAreNotOverwritten();
console.log('draft assistant vector recall tests passed');
