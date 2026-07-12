import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

type WrittenFile = { path: string; content: string };

function createRemoteFsStub(writes: WrittenFile[], files: Record<string, string> = {}) {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => {
      writes.push({ path, content });
      files[path] = content;
    },
    readFile: async (path: string) => {
      if (path in files) return files[path];
      throw new Error(`missing file ${path}`);
    },
    exists: async (path: string) => path in files,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function makeJob(jobId: string, topic = 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向') {
  return {
    jobId,
    skill: 'write-hb',
    payload: {
      topic,
      known_context: JSON.stringify({
        topic,
        databaseSourceOptions: { enabled: true, lookbackDays: 30, maxMetadataRows: 50, maxContentRows: 8 },
        selectedSearchQueries: ['Magnequench 生产工艺 中试 量产', 'Neo Performance Materials Magnequench'],
      }),
    },
    artifacts: {},
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    eventLog: [],
  };
}

function createService(
  writes: WrittenFile[],
  files: Record<string, string>,
  sources: unknown[],
  searchRequests: Array<Record<string, unknown>> = [],
) {
  const vectorSources = {
    search: async (request: Record<string, unknown>) => {
      searchRequests.push(request);
      return ({
      status: 'hit',
      totalHits: sources.length,
      sources,
      updatedAt: new Date().toISOString(),
      queryPlan: {
        enabled: true,
        available: true,
        activeProfile: 'test',
        availableProfiles: [],
        storageMode: 'pgvector_single_table',
        sourceTable: 'vector_materials_text_embedding_v4',
        activeTable: 'vector_materials_text_embedding_v4',
        indexTable: '',
        embeddingModel: 'test-embedding',
        embeddingDimensions: 1024,
        embeddingColumnType: 'vector',
        pgvectorAvailable: true,
        indexedRows: 10,
        vectorHits: sources.length,
        keywordBoostedHits: 0,
        returnedSources: sources.length,
        broadeningApplied: false,
        lastIndexedAt: null,
        fallbackReason: '',
      },
      });
    },
  };
  const service = new ReportsService({} as never, createRemoteFsStub(writes, files) as never, vectorSources as never) as unknown as ReportsService & {
    enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
    jobs: Map<string, Record<string, unknown>>;
  };
  return service;
}

async function testMissingDatabaseLimitsUseDefaults() {
  const writes: WrittenFile[] = [];
  const files: Record<string, string> = {};
  const searchRequests: Array<Record<string, unknown>> = [];
  const service = createService(writes, files, [], searchRequests);
  const job = makeJob('job-default-database-limits');
  job.payload.known_context = JSON.stringify({
    topic: job.payload.topic,
    databaseSourceOptions: { enabled: true },
  });

  await service.enrichPayloadWithVectorSources(job);

  assert.equal(searchRequests.length, 1);
  assert.equal(searchRequests[0].maxRows, 50);
  assert.equal(searchRequests[0].lookbackDays, 30);
}

async function testPreRecallFiltersMismatch() {
  const writes: WrittenFile[] = [];
  const files: Record<string, string> = {};
  const service = createService(writes, files, [
    {
      title: 'Magnequench updates pilot and mass production process',
      url: 'https://example.com/magnequench',
      summary: '麦格昆磁披露生产工艺、中试和量产主要动向。',
      contentExcerpt: 'Neo Performance Materials 下属 Magnequench 相关材料。',
      websiteName: 'Example',
      publishTime: '2026-07-01',
      similarity: 0.88,
      relevanceScore: 0.91,
      retrievalMode: 'vector',
    },
    {
      title: '美光股价可能再次在财报公布后暴跌',
      url: 'https://example.com/micron',
      summary: 'Micron Technology DRAM NAND 财报分析。',
      websiteName: 'Market',
      publishTime: '2026-07-01',
      similarity: 0.99,
      relevanceScore: 0.99,
      retrievalMode: 'vector',
    },
  ]);
  const job = makeJob('job-entity-guard-1');
  await service.enrichPayloadWithVectorSources(job);

  const databaseWrite = writes.find((write) => write.path.endsWith('/database/database_sources.json'));
  assert.ok(databaseWrite);
  const databaseSources = JSON.parse(databaseWrite.content);
  assert.equal(databaseSources.length, 1);
  assert.match(databaseSources[0].ch_title, /Magnequench/);
  assert.doesNotMatch(JSON.stringify(databaseSources), /Micron|美光/);

  const diagnosticsWrite = writes.find((write) => write.path.endsWith('/database/database_sources_diagnostics.json'));
  assert.ok(diagnosticsWrite);
  const diagnostics = JSON.parse(diagnosticsWrite.content);
  assert.equal(diagnostics.rejectedSources.length, 1);
  assert.match(JSON.stringify(diagnostics.rejectedSources), /Micron|美光/);
}

async function testAcceptedEmptyDoesNotReturnHit() {
  const writes: WrittenFile[] = [];
  const files: Record<string, string> = {};
  const service = createService(writes, files, [
    {
      title: '美光：此刻就是真相时刻',
      url: 'https://example.com/micron-only',
      summary: 'Micron Technology DRAM NAND 财报分析。',
      websiteName: 'Market',
      publishTime: '2026-07-01',
      similarity: 0.99,
      relevanceScore: 0.99,
      retrievalMode: 'vector',
    },
  ]);
  const job = makeJob('job-entity-guard-2');
  await service.enrichPayloadWithVectorSources(job);
  service.jobs.set(job.jobId, job);
  const response = await service.getDatabaseSources(job.jobId);
  assert.ok(response);
  assert.notEqual(response?.status, 'hit');
  assert.equal(response?.sources.length, 0);
  assert.ok((response?.rejectedSources?.length || 0) > 0);
  assert.match(response?.message || '', /数据库未找到通过核心实体校验/);
}

async function testAgentWrittenSourcesSecondFilter() {
  const writes: WrittenFile[] = [];
  const files: Record<string, string> = {};
  const service = createService(writes, files, []);
  const job = makeJob('job-entity-guard-3');
  const dir = `/tmp/hermes-reports/${job.jobId}`;
  files[`${dir}/context.json`] = JSON.stringify({
    topic: job.payload.topic,
    entityPolicy: {
      coreEntities: [{ canonical: '麦格昆磁', type: 'company', aliases: ['麦格昆磁', 'Magnequench'], importance: 'primary' }],
      entityRelations: [],
      topicTerms: ['生产工艺', '中试', '量产'],
      actionTerms: ['中试', '量产'],
      timeConstraints: [],
      locationConstraints: [],
      ambiguousTerms: [],
      possibleConfusions: [{ entity: '美光科技', aliases: ['美光', 'Micron'], reason: '错配' }],
      requiredEntityMatch: true,
      searchQueries: [],
      confidence: 0.9,
    },
  });
  files[`${dir}/database/database_sources.json`] = JSON.stringify([
    { ch_title: 'Magnequench pilot production update', data_source_url: 'https://example.com/mq', summary: '麦格昆磁中试和量产进展。', relevance_score: 0.9 },
    { ch_title: 'Micron stock update', data_source_url: 'https://example.com/micron', summary: '美光 Micron DRAM NAND。', relevance_score: 0.99 },
  ]);
  files[`${dir}/database/database_query_plan.json`] = JSON.stringify({ strict_hits: 0, expanded_hits: 2, returned_sources: 2 });
  service.jobs.set(job.jobId, job);

  const response = await service.getDatabaseSources(job.jobId);
  assert.equal(response?.sources.length, 1);
  assert.match(response?.sources[0].title, /Magnequench/);
  assert.equal(response?.rejectedSources?.length, 1);
}

await testPreRecallFiltersMismatch();
await testAcceptedEmptyDoesNotReturnHit();
await testAgentWrittenSourcesSecondFilter();
await testMissingDatabaseLimitsUseDefaults();
console.log('reports database source entity guard tests passed');
