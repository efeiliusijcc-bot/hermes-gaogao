import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

type WrittenFile = { path: string; content: string };

function createRemoteFsStub(writes: WrittenFile[]) {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => writes.push({ path, content }),
    readFile: async () => '{}',
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function createService(writes: WrittenFile[]) {
  const vectorSources = {
    search: async () => ({
      status: 'hit',
      totalHits: 2,
      updatedAt: new Date().toISOString(),
      sources: [
        {
          title: 'Magnequench production process update',
          url: 'https://example.com/mq',
          summary: '麦格昆磁生产工艺、中试和量产进展。',
          contentExcerpt: 'Neo Performance Materials 下属 Magnequench。',
          websiteName: 'Example',
          publishTime: '2026-07-01',
          similarity: 0.86,
          relevanceScore: 0.9,
          retrievalMode: 'vector',
        },
        {
          title: 'Micron Technology earnings preview',
          url: 'https://example.com/micron',
          summary: '美光 Micron Technology DRAM NAND 财报。',
          websiteName: 'Market',
          publishTime: '2026-07-01',
          similarity: 0.98,
          relevanceScore: 0.98,
          retrievalMode: 'vector',
        },
      ],
      queryPlan: {
        enabled: true,
        available: true,
        activeProfile: 'test',
        availableProfiles: [],
        storageMode: 'pgvector_single_table',
        sourceTable: 'vector_materials_text_embedding_v4',
        activeTable: 'vector_materials_text_embedding_v4',
        indexTable: '',
        embeddingModel: 'test',
        embeddingDimensions: 1024,
        embeddingColumnType: 'vector',
        pgvectorAvailable: true,
        indexedRows: 2,
        vectorHits: 2,
        keywordBoostedHits: 0,
        returnedSources: 2,
        broadeningApplied: false,
        lastIndexedAt: null,
        fallbackReason: '',
      },
    }),
  };
  return new ReportsService({} as never, createRemoteFsStub(writes) as never, vectorSources as never) as unknown as {
    enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

async function testContextContainsAcceptedOnlyAndDiagnostics() {
  const writes: WrittenFile[] = [];
  const service = createService(writes);
  const topic = 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向';
  const job = {
    jobId: 'job-context-filter',
    skill: 'write-hb',
    payload: {
      topic,
      known_context: JSON.stringify({
        topic,
        databaseSourceOptions: { enabled: true, lookbackDays: 30, maxMetadataRows: 50, maxContentRows: 8 },
      }),
    },
    artifacts: {},
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    eventLog: [],
  };

  const payload = await service.enrichPayloadWithVectorSources(job);
  const knownContext = JSON.parse(String(payload.known_context));
  assert.equal(knownContext.vectorDatabaseSources.length, 1);
  assert.match(JSON.stringify(knownContext.vectorDatabaseSources), /Magnequench|麦格昆磁/);
  assert.doesNotMatch(JSON.stringify(knownContext.vectorDatabaseSources), /Micron|美光/);
  assert.equal(knownContext.sourceDiagnostics.database.rejectedCount, 1);
  assert.ok(knownContext.sourceDiagnostics.database.entityPolicy);

  const contextWrite = writes.find((write) => write.path.endsWith('/context.json'));
  assert.ok(contextWrite);
  const contextJson = JSON.parse(contextWrite.content);
  assert.equal(contextJson.vectorDatabaseSources.length, 1);
  assert.doesNotMatch(JSON.stringify(contextJson.vectorDatabaseSources), /Micron|美光/);

  const diagnosticsWrite = writes.find((write) => write.path.endsWith('/database/database_sources_diagnostics.json'));
  assert.ok(diagnosticsWrite);
  assert.match(diagnosticsWrite.content, /Micron|美光/);
}

await testContextContainsAcceptedOnlyAndDiagnostics();
console.log('reports context source filter tests passed');
