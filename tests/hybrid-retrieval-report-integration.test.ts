import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';
import { ReportsRetrievalAdapter } from '../server/reports/reports-retrieval.adapter.js';
import type { RetrievalResult } from '../server/reports/retrieval/retrieval.types.js';

const topic = '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火';

function retrievalResult(): RetrievalResult {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    profile: {
      originalQuery: topic,
      supplement: '',
      coreEntities: [
        { canonicalId: 'country:us', canonicalName: '美国', type: 'country', aliases: ['美国', '美方', '华盛顿', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
        { canonicalId: 'country:iran', canonicalName: '伊朗', type: 'country', aliases: ['伊朗', '伊方', '德黑兰', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
      ],
      coreTopics: ['核问题', '黎巴嫩停火'],
      queryVariants: ['美国 伊朗 核问题 黎巴嫩停火'],
    },
    sources: [
      {
        documentId: '101',
        title: '黎巴嫩停火成焦点，首轮谈判结束，美伊会谈聚焦五大议题',
        summary: '美国与伊朗围绕核问题举行技术会谈。',
        content: '双方讨论黎巴嫩停火。',
        url: 'https://example.com/us-iran',
        publishedAt: '2026-07-13T00:00:00.000Z',
        sourceName: 'Reuters',
        retrievalSources: ['vector', 'fulltext', 'title'],
        ranks: { vector: 2, fulltext: 1, title: 1 },
        scores: { vector: 0.91, fulltext: 0.8, title: 0.9, rrf: 0.049, final: 0.88 },
      },
    ],
    diagnostics: {
      vectorCandidateCount: 19,
      fulltextCandidateCount: 12,
      titleCandidateCount: 5,
      entityCandidateCount: 0,
      mergedCandidateCount: 24,
      acceptedCount: 1,
      fallbackLevel: 0,
      suspiciousEntityPolicy: false,
      durationMs: 42,
      retrieverErrors: [],
    },
  };
}

function createRemoteFsStub(writes: Array<{ path: string; content: string }>) {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => writes.push({ path, content }),
    readFile: async () => { throw new Error('missing'); },
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function vectorPlan() {
  return {
    enabled: true,
    available: true,
    activeProfile: 'text-embedding-v4',
    availableProfiles: [],
    storageMode: 'pgvector_single_table' as const,
    embeddingModel: 'text-embedding-v4',
    embeddingDimensions: 1024,
    indexTable: '',
    activeTable: 'vector_materials_text_embedding_v4',
    sourceTable: 'vector_materials_text_embedding_v4',
    embeddingColumnType: 'vector',
    pgvectorAvailable: true,
    indexedRows: 215842,
    vectorHits: 0,
    keywordBoostedHits: 0,
    returnedSources: 0,
    broadeningApplied: false,
    lastIndexedAt: null,
    fallbackReason: '',
  };
}

async function testAdapterUsesCleanInputAndPreservesExplainability() {
  const requests: unknown[] = [];
  const adapter = new ReportsRetrievalAdapter({
    retrieve: async (request: unknown) => {
      requests.push(request);
      return retrievalResult();
    },
  } as never);

  const adapted = await adapter.retrieveDatabaseSources({
    reportJobId: 'f323bc84-a139-4877-a74a-7dde42e0ed60',
    lookbackDays: 30,
    payload: {
      topic,
      known_context: JSON.stringify({ sourceScope: '政府与机构', sourceTypes: ['监管机构'], database: 'PG数据库信源' }),
    },
    payloadContext: {
      supplement: '',
      entities: [{ name: '监管机构', required: true }],
    },
  });

  assert.equal(requests.length, 1);
  assert.equal((requests[0] as { supplement: string }).supplement, '');
  assert.deepEqual((requests[0] as { explicitEntities: unknown[] }).explicitEntities, []);
  assert.doesNotMatch(JSON.stringify(requests[0]), /政府与机构|监管机构|PG数据库信源/);
  const defaultRange = (requests[0] as { explicitTimeRange?: { start?: string; end?: string } }).explicitTimeRange;
  assert.ok(defaultRange?.start);
  assert.ok(defaultRange.end);
  assert.equal(Date.parse(defaultRange.end) - Date.parse(defaultRange.start), 30 * 24 * 60 * 60 * 1000);
  assert.equal(adapted.sources.length, 1);
  assert.equal(adapted.sources[0]?.retrievalMode, 'hybrid');
  assert.equal(adapted.sources[0]?.documentId, '101');
  assert.deepEqual(adapted.sources[0]?.retrievalSources, ['vector', 'fulltext', 'title']);
  assert.equal(adapted.sources[0]?.relevanceScore, 0.88);

  await adapter.retrieveDatabaseSources({
    reportJobId: 'explicit-range-job',
    lookbackDays: 30,
    payload: { topic },
    payloadContext: {
      explicitTimeRange: { start: '2026-01-01', end: '2026-02-01' },
    },
  });
  assert.deepEqual(
    (requests[1] as { explicitTimeRange?: unknown }).explicitTimeRange,
    { start: '2026-01-01', end: '2026-02-01' },
  );
}

async function testDeepReportUsesHybridButNormalReportDoesNot() {
  const previous = process.env.HYBRID_RETRIEVAL_ENABLED;
  process.env.HYBRID_RETRIEVAL_ENABLED = '1';
  try {
    const writes: Array<{ path: string; content: string }> = [];
    let hybridCalls = 0;
    let legacyCalls = 0;
    const hybridInputs: Array<Record<string, unknown>> = [];
    const adapter = {
      retrieveDatabaseSources: async (input: Record<string, unknown>) => {
        hybridCalls += 1;
        hybridInputs.push(input);
        const result = retrievalResult();
        return {
          result,
          sources: result.sources.map((source) => ({
            title: source.title,
            url: source.url || '',
            summary: source.summary || '',
            contentExcerpt: source.content || '',
            websiteName: source.sourceName || '',
            publishTime: source.publishedAt || '',
            similarity: source.scores.vector || 0,
            relevanceScore: source.scores.final || 0,
            retrievalMode: 'hybrid' as const,
            documentId: source.documentId,
            retrievalSources: source.retrievalSources,
            retrievalRanks: source.ranks,
            retrievalScores: source.scores,
            retrievalRunId: result.runId,
          })),
        };
      },
    };
    const vectorSources = {
      status: async () => vectorPlan(),
      search: async () => {
        legacyCalls += 1;
        throw new Error('legacy vector search should not run');
      },
    };
    const service = new ReportsService(
      {} as never,
      createRemoteFsStub(writes) as never,
      vectorSources as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      adapter as never,
    ) as unknown as ReportsService & {
      enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
      jobs: Map<string, Record<string, unknown>>;
    };
    const deepJob = {
      jobId: 'deep-hybrid',
      skill: 'write-hb',
      payload: {
        topic,
        known_context: JSON.stringify({ topic, supplement: '', databaseSourceOptions: { enabled: true } }),
      },
      artifacts: {}, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [], eventLog: [],
    };
    const normalJob = {
      ...deepJob,
      jobId: 'normal-report',
      skill: 'write-hb-k',
      artifacts: {}, events: [], eventLog: [],
    };

    await service.enrichPayloadWithVectorSources(deepJob);
    await service.enrichPayloadWithVectorSources(normalJob);

    assert.equal(hybridCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(hybridInputs[0]?.lookbackDays, 30);
    const databaseWrite = writes.find((write) => write.path.endsWith('/deep-hybrid/database/database_sources.json'));
    assert.ok(databaseWrite);
    const databaseSources = JSON.parse(databaseWrite.content) as Array<Record<string, unknown>>;
    assert.equal(databaseSources.length, 1);
    assert.equal(databaseSources[0]?.ch_title, retrievalResult().sources[0]?.title);
    assert.equal(databaseSources[0]?.source_type, 'pg_vector');
    assert.deepEqual(databaseSources[0]?.retrieval_sources, ['vector', 'fulltext', 'title']);
    assert.equal(databaseSources[0]?.retrieval_run_id, retrievalResult().runId);
    const planWrite = writes.find((write) => write.path.endsWith('/deep-hybrid/database/database_query_plan.json'));
    assert.ok(planWrite);
    const queryPlan = JSON.parse(planWrite.content) as Record<string, unknown>;
    assert.equal(queryPlan.retrieval_mode, 'pg_vector');

    (deepJob.artifacts as Record<string, unknown>).vectorDatabaseSources = [{
      title: '黎巴嫩停火谈判取得阶段进展',
      url: 'https://example.com/ceasefire',
      summary: '技术层级代表继续讨论停火安排。',
      contentExcerpt: '',
      websiteName: 'Reuters',
      publishTime: '2026-07-13T00:00:00.000Z',
      similarity: 0.93,
      relevanceScore: 0.86,
      retrievalMode: 'hybrid',
    }];
    service.jobs.set(deepJob.jobId, deepJob);
    const response = await service.getDatabaseSources(deepJob.jobId);
    assert.equal(response?.status, 'hit');
    assert.equal(response?.sources.length, 1);
    assert.equal(response?.sources[0]?.title, '黎巴嫩停火谈判取得阶段进展');
  } finally {
    if (previous === undefined) delete process.env.HYBRID_RETRIEVAL_ENABLED;
    else process.env.HYBRID_RETRIEVAL_ENABLED = previous;
  }
}

async function testHybridFallbackMessageDoesNotExposeInternalTableNames() {
  const previous = process.env.HYBRID_RETRIEVAL_ENABLED;
  process.env.HYBRID_RETRIEVAL_ENABLED = '1';
  try {
    const writes: Array<{ path: string; content: string }> = [];
    const plan = vectorPlan();
    const service = new ReportsService(
      {} as never,
      createRemoteFsStub(writes) as never,
      {
        status: async () => plan,
        search: async () => ({
          status: 'empty' as const,
          totalHits: 0,
          sources: [],
          updatedAt: new Date().toISOString(),
          queryPlan: plan,
        }),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        retrieveDatabaseSources: async () => {
          throw new Error('Hybrid retrieval sidecars are bound to vector_materials_text_embedding_v4, received vector_materials_qwen3');
        },
      } as never,
    ) as unknown as ReportsService & {
      enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const job = {
      jobId: 'profile-fallback',
      skill: 'write-hb',
      payload: {
        topic,
        known_context: JSON.stringify({ topic, databaseSourceOptions: { enabled: true } }),
      },
      artifacts: {}, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [], eventLog: [],
    };

    await service.enrichPayloadWithVectorSources(job);

    const serializedEvents = JSON.stringify(job.events);
    assert.match(serializedEvents, /已回退现有向量检索/);
    assert.doesNotMatch(serializedEvents, /vector_materials_text_embedding_v4|vector_materials_qwen3/);
  } finally {
    if (previous === undefined) delete process.env.HYBRID_RETRIEVAL_ENABLED;
    else process.env.HYBRID_RETRIEVAL_ENABLED = previous;
  }
}

await testAdapterUsesCleanInputAndPreservesExplainability();
await testDeepReportUsesHybridButNormalReportDoesNot();
await testHybridFallbackMessageDoesNotExposeInternalTableNames();
console.log('hybrid retrieval report integration tests passed');
