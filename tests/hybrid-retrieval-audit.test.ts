import assert from 'node:assert/strict';
import { RetrievalAuditService } from '../server/reports/retrieval/audit/retrieval-audit.service.js';
import type { RetrievalCandidate } from '../server/reports/retrieval/retrieval.types.js';

const candidate: RetrievalCandidate = {
  documentId: '101',
  title: '美伊技术层级会谈聚焦核问题',
  retrievalSources: ['vector', 'title'],
  ranks: { vector: 1, title: 1 },
  scores: { vector: 0.91, title: 0.9, final: 0.88 },
};

async function testRunAndCandidatesPersistAtomically() {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const audit = new RetrievalAuditService({
    query: async <T>(sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] as T[] };
    },
  });

  await audit.persist({
    runId: '11111111-1111-4111-8111-111111111111',
    request: {
      reportJobId: 'f323bc84-a139-4877-a74a-7dde42e0ed60',
      topic: '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火',
      supplement: '',
      explicitEntities: [],
    },
    profile: {
      originalQuery: '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火',
      supplement: '',
      coreEntities: [],
      coreTopics: ['核问题'],
      queryVariants: [],
    },
    diagnostics: {
      vectorCandidateCount: 1,
      fulltextCandidateCount: 0,
      titleCandidateCount: 1,
      entityCandidateCount: 0,
      mergedCandidateCount: 1,
      acceptedCount: 1,
      fallbackLevel: 0,
      suspiciousEntityPolicy: false,
      durationMs: 12,
      retrieverErrors: [],
    },
    decisions: [
      { candidate, accepted: true, reason: 'accepted' },
      { candidate: { ...candidate, documentId: '102' }, accepted: false, reason: 'below-minimum-score' },
    ],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0]?.sql || '', /WITH\s+inserted_run\s+AS/i);
  assert.match(calls[0]?.sql || '', /INSERT INTO hybrid_retrieval_candidates/i);
  assert.ok((calls[0]?.params || []).includes('102'));
}

await testRunAndCandidatesPersistAtomically();
console.log('hybrid retrieval audit tests passed');
