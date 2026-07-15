import assert from 'node:assert/strict';
import { EntityRetrieverService } from '../server/reports/retrieval/retrievers/entity-retriever.service.js';
import { FulltextRetrieverService } from '../server/reports/retrieval/retrievers/fulltext-retriever.service.js';
import { TitleRetrieverService } from '../server/reports/retrieval/retrievers/title-retriever.service.js';
import { VectorRetrieverService } from '../server/reports/retrieval/retrievers/vector-retriever.service.js';
import type { RetrievalConfig, RetrievalDb } from '../server/reports/retrieval/retrieval.tokens.js';
import type { QueryProfile } from '../server/reports/retrieval/retrieval.types.js';

interface QueryCall {
  sql: string;
  params: readonly unknown[];
  hnswEfSearch?: number;
}

const profile: QueryProfile = {
  originalQuery: '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火',
  supplement: '',
  coreEntities: [
    {
      canonicalId: 'country:us',
      canonicalName: '美国',
      type: 'country',
      aliases: ['美国', '美方', '华盛顿', '美伊'],
      source: 'topic',
      confidence: 0.98,
      enforcement: 'soft',
    },
    {
      canonicalId: 'country:iran',
      canonicalName: '伊朗',
      type: 'country',
      aliases: ['伊朗', '伊方', '德黑兰', '美伊'],
      source: 'topic',
      confidence: 0.98,
      enforcement: 'soft',
    },
  ],
  coreTopics: ['技术层级会谈', '核问题', '黎巴嫩停火'],
  queryVariants: ['美国 伊朗 技术层级会谈 核问题 黎巴嫩停火'],
};

const config: RetrievalConfig = {
  sourceTable: 'vector_materials_text_embedding_v4',
  embeddingModel: 'text-embedding-v4',
  embeddingDimensions: 1024,
  vectorTopK: 100,
  fulltextTopK: 100,
  titleTopK: 50,
  entityTopK: 100,
  fusionTopK: 50,
  finalTopK: 12,
  rrfK: 60,
  minimumCandidateCountForFallback: 10,
  minimumFinalScore: 0.28,
  emergencyMinimumFinalScore: 0.16,
  expandedTopKMultiplier: 2,
  freshnessHalfLifeDays: 90,
  sourceQualityDefault: 0.5,
};

function sourceRow() {
  return {
    document_id: '101',
    title: '黎巴嫩停火成焦点，首轮谈判结束，美伊会谈聚焦五大议题',
    summary: '美国和伊朗围绕核问题继续技术层级会谈。',
    content: '双方同时讨论黎巴嫩停火问题。',
    url: 'https://example.com/us-iran-talks',
    published_at: '2026-07-13T00:00:00.000Z',
    source_name: 'Example News',
    score: 0.93,
  };
}

function createDb(handler?: (sql: string, params: readonly unknown[]) => { rows: unknown[] }) {
  const calls: QueryCall[] = [];
  const execute = async <T>(sql: string, params: readonly unknown[], hnswEfSearch?: number) => {
    calls.push({ sql, params, hnswEfSearch });
    const result = handler ? handler(sql, params) : { rows: [sourceRow()] };
    return { rows: result.rows as T[] };
  };
  const db: RetrievalDb = {
    query: async <T>(sql: string, params: readonly unknown[] = []) => execute<T>(sql, params),
    queryWithHnswEfSearch: async <T>(efSearch: number, sql: string, params: readonly unknown[] = []) =>
      execute<T>(sql, params, efSearch),
  };
  return { db, calls };
}

async function testVectorRetrieverUsesActualPgvectorSchema() {
  const { db, calls } = createDb();
  const candidates = await new VectorRetrieverService(db, config).retrieve({
    profile,
    queryEmbedding: Array.from({ length: 1024 }, () => 0.01),
    limit: 100,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.documentId, '101');
  assert.deepEqual(candidates[0]?.retrievalSources, ['vector']);
  assert.match(calls[0]?.sql || '', /FROM\s+"vector_materials_text_embedding_v4"/);
  assert.match(calls[0]?.sql || '', /embedding_vector\s*<=>\s*\$1::vector/);
  assert.equal(calls[0]?.hnswEfSearch, 200);
  assert.match(calls[0]?.sql || '', /ch_title/);
  assert.match(calls[0]?.sql || '', /data_source_url/);
  assert.equal(calls[0]?.params.at(-1), 100);
  assert.ok(calls[0]?.params.includes('text-embedding-v4'));
}

async function testVectorRetrieverUsesProviderActiveProfile() {
  const { db, calls } = createDb();
  const profiledDb = Object.assign(db, {
    retrievalProfile: () => ({
      sourceTable: 'vector_materials_text_embedding_v4',
      embeddingModel: 'text-embedding-v4',
      embeddingDimensions: 1024,
    }),
  });
  const staleConfig = {
    ...config,
    sourceTable: 'vector_materials_qwen3',
    embeddingModel: 'Qwen3-Embedding-0.6B-Q8',
  };

  await new VectorRetrieverService(profiledDb, staleConfig).retrieve({
    profile,
    queryEmbedding: Array.from({ length: 1024 }, () => 0.01),
    limit: 100,
  });

  assert.match(calls[0]?.sql || '', /vector_materials_text_embedding_v4/);
  assert.ok(calls[0]?.params.includes('text-embedding-v4'));
  assert.doesNotMatch(calls[0]?.sql || '', /vector_materials_qwen3/);
}

async function testFulltextRetrieverUsesPretokenizedGinColumn() {
  const { db, calls } = createDb();
  const candidates = await new FulltextRetrieverService(db, config).retrieve({
    profile,
    queryEmbedding: [],
    limit: 100,
  });

  assert.equal(candidates.length, 1);
  assert.match(calls[0]?.sql || '', /hybrid_retrieval_search_documents/);
  assert.match(calls[0]?.sql || '', /search_vector\s*@@/);
  assert.match(calls[0]?.sql || '', /websearch_to_tsquery\('simple'/);
  assert.match(String(calls[0]?.params[0]), /美国|美伊/);
  assert.equal(calls[0]?.params.at(-1), 100);
}

async function testTitleRetrieverUsesTrigramAndKeywordPatterns() {
  const { db, calls } = createDb();
  const candidates = await new TitleRetrieverService(db, config).retrieve({
    profile,
    queryEmbedding: [],
    limit: 50,
  });

  assert.equal(candidates.length, 1);
  assert.match(calls[0]?.sql || '', /similarity\(/);
  assert.match(calls[0]?.sql || '', /\%\s+\$1/);
  assert.match(calls[0]?.sql || '', /ILIKE\s+\$2/);
  assert.ok(calls[0]?.params.includes('%核问题%'));
  assert.ok(!calls[0]?.params.includes('%美国%'));
  assert.equal(calls[0]?.params.at(-1), 50);
}

async function testTitleRetrieverFallsBackToOriginalQueryForShortTerms() {
  const shortTermProfile: QueryProfile = {
    ...profile,
    originalQuery: '北约峰会',
    coreEntities: [
      {
        canonicalId: 'organization:nato',
        canonicalName: '北约',
        type: 'organization',
        aliases: ['北约'],
        source: 'topic',
        confidence: 0.98,
        enforcement: 'soft',
      },
    ],
    coreTopics: [],
    queryVariants: ['北约峰会'],
  };
  const { db, calls } = createDb();

  const candidates = await new TitleRetrieverService(db, config).retrieve({
    profile: shortTermProfile,
    queryEmbedding: [],
    limit: 50,
  });

  assert.equal(candidates.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.params[0], '北约峰会');
  assert.ok(calls[0]?.params.includes('%北约峰会%'));
}

async function testEntityRetrieverReturnsEmptyUntilIndexExists() {
  const { db, calls } = createDb((sql) => {
    if (sql.includes('to_regclass')) return { rows: [{ available: false }] };
    throw new Error('entity query should not run without index table');
  });
  const candidates = await new EntityRetrieverService(db, config).retrieve({
    profile,
    queryEmbedding: [],
    limit: 100,
  });

  assert.deepEqual(candidates, []);
  assert.equal(calls.length, 1);
}

async function testSidecarRetrieversRejectMismatchedActiveProfile() {
  const { db, calls } = createDb();
  const profiledDb = Object.assign(db, {
    retrievalProfile: () => ({
      sourceTable: 'vector_materials_qwen3',
      embeddingModel: 'Qwen3-Embedding-0.6B-Q8',
      embeddingDimensions: 1024,
    }),
  });
  const request = { profile, queryEmbedding: [], limit: 100 };

  const fulltext = await new FulltextRetrieverService(profiledDb, config).retrieve(request);
  const entity = await new EntityRetrieverService(profiledDb, config).retrieve(request);
  const title = await new TitleRetrieverService(profiledDb, config).retrieve(request);

  assert.deepEqual(fulltext, []);
  assert.deepEqual(entity, []);
  assert.deepEqual(title, []);
  assert.equal(calls.length, 0);
}

await testVectorRetrieverUsesActualPgvectorSchema();
await testVectorRetrieverUsesProviderActiveProfile();
await testFulltextRetrieverUsesPretokenizedGinColumn();
await testTitleRetrieverUsesTrigramAndKeywordPatterns();
await testTitleRetrieverFallsBackToOriginalQueryForShortTerms();
await testEntityRetrieverReturnsEmptyUntilIndexExists();
await testSidecarRetrieversRejectMismatchedActiveProfile();
console.log('hybrid retrieval retriever tests passed');
