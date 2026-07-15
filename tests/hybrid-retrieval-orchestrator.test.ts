import assert from 'node:assert/strict';
import { DEFAULT_RETRIEVAL_CONFIG } from '../server/reports/retrieval/retrieval.config.js';
import { RetrievalOrchestratorService } from '../server/reports/retrieval/retrieval-orchestrator.service.js';
import { RrfFusionService } from '../server/reports/retrieval/fusion/rrf-fusion.service.js';
import { CandidateRerankerService } from '../server/reports/retrieval/rerank/candidate-reranker.service.js';
import { EntityMatchService } from '../server/reports/retrieval/policy/entity-match.service.js';
import { CandidatePolicyService } from '../server/reports/retrieval/policy/candidate-policy.service.js';
import { FallbackPolicyService } from '../server/reports/retrieval/policy/fallback-policy.service.js';
import type {
  CleanRetrievalInput,
  QueryProfile,
  RetrievalCandidate,
  RetrievalSource,
} from '../server/reports/retrieval/retrieval.types.js';
import type { CandidateRetriever, RetrieverRequest } from '../server/reports/retrieval/retrievers/retriever.interface.js';

const request: CleanRetrievalInput = {
  reportJobId: 'f323bc84-a139-4877-a74a-7dde42e0ed60',
  topic: '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火',
  supplement: '',
  explicitEntities: [],
};

const profile: QueryProfile = {
  originalQuery: request.topic,
  supplement: '',
  coreEntities: [
    { canonicalId: 'country:us', canonicalName: '美国', type: 'country', aliases: ['美国', '美方', '华盛顿', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
    { canonicalId: 'country:iran', canonicalName: '伊朗', type: 'country', aliases: ['伊朗', '伊方', '德黑兰', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
  ],
  coreTopics: ['技术层级会谈', '核问题', '黎巴嫩停火'],
  queryVariants: ['美国 伊朗 技术层级会谈 核问题 黎巴嫩停火'],
};

function hit(source: RetrievalSource, rank: number): RetrievalCandidate {
  return {
    documentId: '101',
    title: '黎巴嫩停火成焦点，首轮谈判结束，美伊会谈聚焦五大议题',
    summary: '美国和伊朗代表围绕核问题继续技术层级会谈。',
    content: '双方讨论黎巴嫩停火。',
    url: 'https://example.com/incident',
    publishedAt: new Date().toISOString(),
    sourceName: 'Reuters',
    retrievalSources: [source],
    ranks: { [source]: rank },
    scores: { [source]: 0.9 },
  };
}

function retriever(
  source: RetrievalSource,
  requests: RetrieverRequest[],
  execute: () => Promise<RetrievalCandidate[]>,
): CandidateRetriever {
  return {
    source,
    retrieve: async (input) => {
      requests.push(input);
      return execute();
    },
  };
}

async function testOneRetrieverAndAuditFailureDoNotBlockResults() {
  const requests: Record<RetrievalSource, RetrieverRequest[]> = {
    vector: [],
    fulltext: [],
    title: [],
    entity: [],
  };
  const config = { ...DEFAULT_RETRIEVAL_CONFIG, finalTopK: 12 };
  const candidatePolicy = new CandidatePolicyService(config, new EntityMatchService());
  const fallback = new FallbackPolicyService(config, candidatePolicy);
  const auditCalls: unknown[] = [];
  const orchestrator = new RetrievalOrchestratorService(
    { embedQuery: async () => Array.from({ length: 1024 }, () => 0.01) },
    config,
    { parse: () => profile } as never,
    retriever('vector', requests.vector, async () => { throw new Error('vector unavailable'); }) as never,
    retriever('fulltext', requests.fulltext, async () => [hit('fulltext', 1)]) as never,
    retriever('title', requests.title, async () => [hit('title', 1)]) as never,
    retriever('entity', requests.entity, async () => []) as never,
    new RrfFusionService(),
    new CandidateRerankerService(config),
    fallback,
    {
      persist: async (value: unknown) => {
        auditCalls.push(value);
        throw new Error('audit table unavailable');
      },
    } as never,
  );

  const result = await orchestrator.retrieve(request);

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.documentId, '101');
  assert.deepEqual(new Set(result.sources[0]?.retrievalSources), new Set(['fulltext', 'title']));
  assert.equal(result.diagnostics.vectorCandidateCount, 0);
  assert.equal(result.diagnostics.fulltextCandidateCount, 1);
  assert.equal(result.diagnostics.titleCandidateCount, 1);
  assert.equal(result.diagnostics.entityCandidateCount, 0);
  assert.equal(result.diagnostics.acceptedCount, 1);
  assert.equal(result.diagnostics.retrieverErrors.length, 1);
  assert.equal(result.diagnostics.retrieverErrors[0]?.source, 'vector');
  assert.match(result.diagnostics.retrieverErrors[0]?.message || '', /vector unavailable/);
  assert.equal(requests.vector[0]?.limit, 100);
  assert.equal(requests.fulltext[0]?.limit, 100);
  assert.equal(requests.title[0]?.limit, 50);
  assert.equal(requests.entity[0]?.limit, 100);
  assert.equal(auditCalls.length, 1);
}

async function testLevelFourExpandsEvenWhenInitialCandidateCountIsLow() {
  const requests: Record<RetrievalSource, RetrieverRequest[]> = {
    vector: [],
    fulltext: [],
    title: [],
    entity: [],
  };
  const config = { ...DEFAULT_RETRIEVAL_CONFIG, finalTopK: 12 };
  const candidatePolicy = new CandidatePolicyService(config, new EntityMatchService());
  const fallback = new FallbackPolicyService(config, candidatePolicy);
  const secondPassHit = (source: RetrievalSource, sourceRequests: RetrieverRequest[]) =>
    retriever(source, sourceRequests, async () => sourceRequests.length === 1 ? [] : [hit(source, 1)]);
  const orchestrator = new RetrievalOrchestratorService(
    { embedQuery: async () => Array.from({ length: 1024 }, () => 0.01) },
    config,
    { parse: () => profile } as never,
    secondPassHit('vector', requests.vector) as never,
    secondPassHit('fulltext', requests.fulltext) as never,
    secondPassHit('title', requests.title) as never,
    secondPassHit('entity', requests.entity) as never,
    new RrfFusionService(),
    new CandidateRerankerService(config),
    fallback,
    { persist: async () => undefined } as never,
  );

  const result = await orchestrator.retrieve(request);

  assert.equal(requests.vector.length, 2);
  assert.equal(requests.vector[1]?.limit, 200);
  assert.equal(requests.title[1]?.limit, 100);
  assert.equal(result.diagnostics.fallbackLevel, 4);
  assert.equal(result.sources.length, 1);
}

async function testUnsupportedActiveProfileFallsBackBeforeHybridRetrieval() {
  const config = { ...DEFAULT_RETRIEVAL_CONFIG };
  const candidatePolicy = new CandidatePolicyService(config, new EntityMatchService());
  const emptyRetriever = (source: RetrievalSource) => ({ source, retrieve: async () => [] });
  const orchestrator = new RetrievalOrchestratorService(
    {
      embedQuery: async () => { throw new Error('embedding should not run'); },
      retrievalProfile: () => ({
        sourceTable: 'vector_materials_qwen3',
        embeddingModel: 'Qwen3-Embedding-0.6B-Q8',
        embeddingDimensions: 1024,
      }),
    } as never,
    config,
    { parse: () => profile } as never,
    emptyRetriever('vector') as never,
    emptyRetriever('fulltext') as never,
    emptyRetriever('title') as never,
    emptyRetriever('entity') as never,
    new RrfFusionService(),
    new CandidateRerankerService(config),
    new FallbackPolicyService(config, candidatePolicy),
    { persist: async () => undefined } as never,
  );

  await assert.rejects(
    () => orchestrator.retrieve(request),
    /sidecars are bound to vector_materials_text_embedding_v4/,
  );
}

await testOneRetrieverAndAuditFailureDoNotBlockResults();
await testLevelFourExpandsEvenWhenInitialCandidateCountIsLow();
await testUnsupportedActiveProfileFallsBackBeforeHybridRetrieval();
console.log('hybrid retrieval orchestrator tests passed');
