import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const INCIDENT_JOB_ID = 'f323bc84-a139-4877-a74a-7dde42e0ed60';
const INCIDENT_TOPIC = '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火';

function createRemoteFsStub() {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    readFile: async () => {
      throw new Error('missing test file');
    },
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function emptyVectorResult() {
  return {
    status: 'empty' as const,
    totalHits: 0,
    sources: [],
    updatedAt: new Date().toISOString(),
    queryPlan: {
      enabled: true,
      available: true,
      activeProfile: 'text-embedding-v4',
      availableProfiles: [],
      storageMode: 'pgvector_single_table' as const,
      sourceTable: 'vector_materials_text_embedding_v4',
      activeTable: 'vector_materials_text_embedding_v4',
      indexTable: '',
      embeddingModel: 'text-embedding-v4',
      embeddingDimensions: 1024,
      embeddingColumnType: 'vector',
      pgvectorAvailable: true,
      indexedRows: 215842,
      vectorHits: 0,
      keywordBoostedHits: 0,
      returnedSources: 0,
      broadeningApplied: false,
      lastIndexedAt: null,
      fallbackReason: '',
    },
  };
}

async function testEmptySupplementNeverFallsBackToKnownContext() {
  let extractorInput: Record<string, unknown> | undefined;
  const hermes = {
    extractEntityPolicy: async (input: Record<string, unknown>) => {
      extractorInput = input;
      return {
        coreEntities: [],
        entityRelations: [],
        topicTerms: [],
        actionTerms: [],
        timeConstraints: [],
        locationConstraints: [],
        ambiguousTerms: [],
        possibleConfusions: [],
        requiredEntityMatch: false,
        searchQueries: [],
        confidence: 0,
        generatedBy: 'llm' as const,
      };
    },
  };
  const vectorSources = { search: async () => emptyVectorResult() };
  const service = new ReportsService(
    hermes as never,
    createRemoteFsStub() as never,
    vectorSources as never,
  ) as unknown as ReportsService & {
    enrichPayloadWithVectorSources(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  const knownContext = {
    topic: INCIDENT_TOPIC,
    supplement: '',
    databaseSourceOptions: { enabled: true },
    sourceScope: '政府与机构公告',
    sourceTypes: ['监管机构', '智库研判', '专业机构'],
    workflow: 'PG数据库信源',
    stage: '数据库检索',
  };
  const job = {
    jobId: INCIDENT_JOB_ID,
    skill: 'write-hb',
    payload: {
      topic: INCIDENT_TOPIC,
      known_context: JSON.stringify(knownContext),
    },
    artifacts: {},
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    eventLog: [],
  };

  await service.enrichPayloadWithVectorSources(job);

  assert.ok(extractorInput);
  assert.equal(extractorInput.userSupplement, '');
  const serialized = JSON.stringify(extractorInput);
  for (const forbidden of ['政府与机构', '监管机构', '智库研判', '专业机构', 'PG数据库信源']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
}

await testEmptySupplementNeverFallsBackToKnownContext();
console.log('hybrid retrieval clean query regression tests passed');
