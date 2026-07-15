import assert from 'node:assert/strict';
import { ReportsRetrievalAdapter } from '../server/reports/reports-retrieval.adapter.js';
import type { CleanRetrievalInput, RetrievalResult } from '../server/reports/retrieval/retrieval.types.js';

const topic = 'Test report topic';

function emptyResult(): RetrievalResult {
  return {
    runId: 'adapter-test-run',
    profile: {
      originalQuery: topic,
      supplement: '',
      coreEntities: [],
      coreTopics: [],
      queryVariants: [topic],
    },
    sources: [],
    diagnostics: {
      vectorCandidateCount: 0,
      fulltextCandidateCount: 0,
      titleCandidateCount: 0,
      entityCandidateCount: 0,
      mergedCandidateCount: 0,
      acceptedCount: 0,
      fallbackLevel: 0,
      suspiciousEntityPolicy: false,
      durationMs: 0,
      retrieverErrors: [],
    },
  };
}

function adapterWithRequests(requests: CleanRetrievalInput[]): ReportsRetrievalAdapter {
  return new ReportsRetrievalAdapter({
    retrieve: async (request: CleanRetrievalInput) => {
      requests.push(request);
      return emptyResult();
    },
  } as never);
}

async function testUsesLookbackDaysForTheDefaultDateRange() {
  const requests: CleanRetrievalInput[] = [];
  const adapter = adapterWithRequests(requests);

  await adapter.retrieveDatabaseSources({
    reportJobId: 'default-lookback',
    lookbackDays: 14,
    payload: { topic },
    payloadContext: {},
  });

  const range = requests[0]?.explicitTimeRange;
  assert.ok(range?.start);
  assert.ok(range?.end);
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 14 * 24 * 60 * 60 * 1000);
}

async function testKeepsExplicitDateRangeOverTheLookbackDefault() {
  const requests: CleanRetrievalInput[] = [];
  const adapter = adapterWithRequests(requests);

  await adapter.retrieveDatabaseSources({
    reportJobId: 'explicit-range',
    lookbackDays: 30,
    payload: { topic },
    payloadContext: {
      explicitTimeRange: { start: '2026-01-01', end: '2026-02-01' },
    },
  });

  assert.deepEqual(requests[0]?.explicitTimeRange, { start: '2026-01-01', end: '2026-02-01' });
}

await testUsesLookbackDaysForTheDefaultDateRange();
await testKeepsExplicitDateRangeOverTheLookbackDefault();
console.log('reports retrieval adapter tests passed');
