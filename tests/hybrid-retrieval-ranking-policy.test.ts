import assert from 'node:assert/strict';
import { DEFAULT_RETRIEVAL_CONFIG } from '../server/reports/retrieval/retrieval.config.js';
import { RrfFusionService } from '../server/reports/retrieval/fusion/rrf-fusion.service.js';
import { CandidateRerankerService } from '../server/reports/retrieval/rerank/candidate-reranker.service.js';
import { EntityMatchService } from '../server/reports/retrieval/policy/entity-match.service.js';
import { CandidatePolicyService } from '../server/reports/retrieval/policy/candidate-policy.service.js';
import { FallbackPolicyService } from '../server/reports/retrieval/policy/fallback-policy.service.js';
import type { QueryProfile, RetrievalCandidate, RetrievalSource } from '../server/reports/retrieval/retrieval.types.js';

function candidate(documentId: string, source: RetrievalSource, rank: number, title = documentId): RetrievalCandidate {
  return {
    documentId,
    title,
    summary: '美国和伊朗代表围绕核问题继续技术会谈。',
    content: '双方同时讨论黎巴嫩停火议题。',
    publishedAt: new Date().toISOString(),
    sourceName: 'Example News',
    retrievalSources: [source],
    ranks: { [source]: rank },
    scores: { [source]: 1 / rank },
  };
}

const incidentProfile: QueryProfile = {
  originalQuery: '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火',
  supplement: '',
  coreEntities: [
    { canonicalId: 'country:us', canonicalName: '美国', type: 'country', aliases: ['美国', '美方', '华盛顿', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
    { canonicalId: 'country:iran', canonicalName: '伊朗', type: 'country', aliases: ['伊朗', '伊方', '德黑兰', '美伊'], source: 'topic', confidence: 0.98, enforcement: 'soft' },
  ],
  coreTopics: ['技术层级会谈', '核问题', '黎巴嫩停火'],
  queryVariants: ['美国 伊朗 技术层级会谈 核问题 黎巴嫩停火'],
};

function testRrfDeduplicatesAndRewardsMultipleChannels() {
  const result = new RrfFusionService().fuse([
    [candidate('shared', 'vector', 2), candidate('vector-only', 'vector', 1)],
    [candidate('shared', 'fulltext', 1), candidate('fulltext-only', 'fulltext', 2)],
    [candidate('shared', 'title', 1)],
  ], 60, 50);

  assert.equal(result.length, 3);
  assert.equal(result[0]?.documentId, 'shared');
  assert.deepEqual(new Set(result[0]?.retrievalSources), new Set(['vector', 'fulltext', 'title']));
  const expected = 1 / 62 + 1 / 61 + 1 / 61;
  assert.ok(Math.abs((result[0]?.scores.rrf || 0) - expected) < 1e-12);
}

function testRerankerPromotesHighMatchingIncidentTitle() {
  const relevant = candidate(
    'relevant',
    'vector',
    2,
    '黎巴嫩停火成焦点，首轮谈判结束，美伊会谈聚焦五大议题',
  );
  relevant.scores.vector = 0.88;
  relevant.scores.rrf = 0.03;
  const unrelated = candidate('unrelated', 'vector', 1, '全球市场今日走势');
  unrelated.summary = '市场交易和企业财报。';
  unrelated.content = '与外交谈判无关。';
  unrelated.scores.vector = 0.9;
  unrelated.scores.rrf = 0.031;

  const result = new CandidateRerankerService(DEFAULT_RETRIEVAL_CONFIG).rerank(
    [unrelated, relevant],
    incidentProfile,
  );

  assert.equal(result[0]?.documentId, 'relevant');
  assert.ok((result[0]?.scores.entityCoverage || 0) > 0);
  assert.ok((result[0]?.scores.topicCoverage || 0) > 0);
  assert.ok((result[0]?.scores.titleCoverage || 0) > 0);
}

function createFallback() {
  const matches = new EntityMatchService();
  const policy = new CandidatePolicyService(DEFAULT_RETRIEVAL_CONFIG, matches);
  return new FallbackPolicyService(DEFAULT_RETRIEVAL_CONFIG, policy);
}

function testUniformDerivedEntityRejectionFallsBackAndIsMarkedSuspicious() {
  const profile: QueryProfile = {
    ...incidentProfile,
    coreEntities: [
      {
        canonicalId: 'bad:pg',
        canonicalName: 'PG',
        type: 'organization',
        aliases: ['PG数据库信源'],
        source: 'rule',
        confidence: 0.2,
        enforcement: 'hard',
      },
    ],
  };
  const candidates = Array.from({ length: 19 }, (_, index) => {
    const item = candidate(`incident-${index}`, 'vector', index + 1, `美伊会谈聚焦核问题 ${index}`);
    item.scores.final = 0.8;
    return item;
  });

  const result = createFallback().select(candidates, profile);

  assert.equal(result.fallbackLevel, 1);
  assert.equal(result.accepted.length, 12);
  assert.equal(result.suspiciousEntityPolicy, true);
  assert.match(result.reason, /suspicious-derived-entity-policy/);
}

function testExplicitRequiredEntitySurvivesEveryFallbackLevel() {
  const profile: QueryProfile = {
    ...incidentProfile,
    coreEntities: [
      {
        canonicalId: 'country:france',
        canonicalName: '法国',
        type: 'country',
        aliases: ['法国', '法方', '巴黎'],
        source: 'explicit',
        confidence: 1,
        enforcement: 'hard',
      },
    ],
  };
  const candidates = Array.from({ length: 12 }, (_, index) => {
    const item = candidate(`not-france-${index}`, 'vector', index + 1, `美伊会谈 ${index}`);
    item.scores.final = 0.9;
    return item;
  });

  const result = createFallback().select(candidates, profile);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.fallbackLevel, 4);
  assert.equal(result.needsExpandedRetrieval, true);
  assert.ok(result.decisions.every((decision) => decision.reason.includes('country:france')));
}

function testAuditDecisionsMatchFinalTopKSelection() {
  const policy = new CandidatePolicyService(DEFAULT_RETRIEVAL_CONFIG, new EntityMatchService());
  const candidates = Array.from({ length: 13 }, (_, index) => {
    const item = candidate(`topk-${index + 1}`, 'vector', index + 1, `美伊会谈聚焦核问题 ${index + 1}`);
    item.scores.final = 0.9 - index * 0.01;
    return item;
  });

  const result = policy.evaluate(candidates, incidentProfile, 'normal');

  assert.equal(result.accepted.length, 12);
  assert.equal(result.decisions.filter((decision) => decision.accepted).length, 12);
  assert.equal(result.decisions[12]?.accepted, false);
  assert.equal(result.decisions[12]?.reason, 'outside-final-top-k');
}

testRrfDeduplicatesAndRewardsMultipleChannels();
testRerankerPromotesHighMatchingIncidentTitle();
testUniformDerivedEntityRejectionFallsBackAndIsMarkedSuspicious();
testExplicitRequiredEntitySurvivesEveryFallbackLevel();
testAuditDecisionsMatchFinalTopKSelection();
console.log('hybrid retrieval ranking and fallback tests passed');
