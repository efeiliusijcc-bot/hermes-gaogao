import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { RetrievalOrchestratorService } from '../server/reports/retrieval/retrieval-orchestrator.service.js';
import { DEFAULT_RETRIEVAL_CONFIG } from '../server/reports/retrieval/retrieval.config.js';
import { CandidatePolicyService } from '../server/reports/retrieval/policy/candidate-policy.service.js';
import { EntityMatchService } from '../server/reports/retrieval/policy/entity-match.service.js';
import type { CleanRetrievalInput, QueryProfile, RetrievalCandidate, RetrievalDiagnostics, RetrievalResult } from '../server/reports/retrieval/retrieval.types.js';
import { SourceRecallAccessService } from '../server/source-recall-access.service.js';
import { SourceRecallController } from '../server/source-recall.controller.js';
import { SourceRecallGuard } from '../server/source-recall.guard.js';
import { SourceRecallService } from '../server/source-recall.service.js';

const originalEnvironment = {
  enabled: process.env.SOURCE_RECALL_API_ENABLED,
  key: process.env.SOURCE_RECALL_API_KEY,
  clientId: process.env.SOURCE_RECALL_CLIENT_ID,
  rate: process.env.SOURCE_RECALL_RATE_LIMIT_PER_MINUTE,
  concurrency: process.env.SOURCE_RECALL_MAX_CONCURRENCY,
};

function diagnostics(overrides: Partial<RetrievalDiagnostics> = {}): RetrievalDiagnostics {
  return {
    vectorCandidateCount: 1,
    fulltextCandidateCount: 1,
    titleCandidateCount: 1,
    entityCandidateCount: 1,
    mergedCandidateCount: 1,
    acceptedCount: 1,
    fallbackLevel: 0,
    suspiciousEntityPolicy: false,
    durationMs: 12,
    retrieverErrors: [],
    ...overrides,
  };
}

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    runId: '4f87b29d-5a2a-4a60-a590-440636e36b1e',
    profile: { originalQuery: 'test', supplement: '', coreEntities: [], coreTopics: [], queryVariants: ['test'] },
    sources: [{
      documentId: 'doc-1',
      title: '欧盟发布贸易救济公告',
      summary: '公告摘要',
      content: '公告正文片段',
      url: 'https://example.com/source',
      publishedAt: '2026-08-16T00:00:00.000Z',
      sourceName: 'Official Journal',
      retrievalSources: ['fulltext', 'title'],
      ranks: { fulltext: 1, title: 1 },
      scores: { fulltext: 0.9, title: 0.8, final: 0.88 },
    }],
    diagnostics: diagnostics(),
    ...overrides,
  };
}

async function responseBody(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
}

async function withApi(
  retrieve: (...args: unknown[]) => Promise<RetrievalResult>,
  run: (baseUrl: string, calls: unknown[][]) => Promise<void>,
) {
  const calls: unknown[][] = [];
  const orchestrator = {
    retrieve: async (...args: unknown[]) => {
      calls.push(args);
      return retrieve(...args);
    },
  };

  @Module({
    controllers: [SourceRecallController],
    providers: [
      SourceRecallAccessService,
      SourceRecallGuard,
      SourceRecallService,
      { provide: RetrievalOrchestratorService, useValue: orchestrator },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`, calls);
  } finally {
    await app.close();
  }
}

async function post(baseUrl: string, body: unknown, key?: string) {
  return fetch(`${baseUrl}/api/external/source-recall`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-Hermes-Recall-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function testAuthenticationAndSuccessfulContract() {
  process.env.SOURCE_RECALL_API_ENABLED = 'false';
  delete process.env.SOURCE_RECALL_API_KEY;
  process.env.SOURCE_RECALL_RATE_LIMIT_PER_MINUTE = '1000';
  await withApi(async () => retrievalResult(), async (baseUrl, calls) => {
    await responseBody(await post(baseUrl, { topic: 'test' }, 'service-key'), 503);

    process.env.SOURCE_RECALL_API_ENABLED = 'true';
    await responseBody(await post(baseUrl, { topic: 'test' }, 'service-key'), 503);

    process.env.SOURCE_RECALL_API_KEY = 'service-key';
    await responseBody(await post(baseUrl, { topic: 'test' }, 'wrong-key'), 401);

    const response = await post(baseUrl, {
      topic: '欧盟对华反倾销调查',
      supplement: '背景资料',
      explicitEntities: [{ name: '欧盟委员会', aliases: ['European Commission'], type: 'organization', required: true }],
      lookbackDays: 365,
      limit: 20,
    }, 'service-key');
    const body = await responseBody(response, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('ratelimit-limit'), '1000');
    assert.equal(body.status, 'hit');
    assert.equal(body.requestId, '4f87b29d-5a2a-4a60-a590-440636e36b1e');
    assert.equal(body.retrievalMode, 'hybrid');
    assert.equal(body.sources[0].excerpt, '公告正文片段');
    assert.equal(body.totalHits, 1);
    assert.equal(calls.length, 1);
    const [request, options] = calls[0] as [Record<string, unknown>, Record<string, unknown>];
    assert.match(String(request.reportJobId), /^external:other-project:/);
    assert.equal(request.topic, '欧盟对华反倾销调查');
    assert.deepEqual(options, { finalLimit: 20, auditMode: 'metadata-only' });
  });
}

async function testValidationBoundaries() {
  process.env.SOURCE_RECALL_API_ENABLED = 'true';
  process.env.SOURCE_RECALL_API_KEY = 'service-key';
  process.env.SOURCE_RECALL_RATE_LIMIT_PER_MINUTE = '1000';
  await withApi(async () => retrievalResult(), async (baseUrl, calls) => {
    const invalidBodies = [
      {},
      { topic: 'x'.repeat(501) },
      { topic: 'x', supplement: 'x'.repeat(5001) },
      { topic: 'x', explicitEntities: Array.from({ length: 21 }, () => ({ name: 'entity' })) },
      { topic: 'x', lookbackDays: 30, timeRange: { start: '2026-01-01' } },
      { topic: 'x', timeRange: { start: 'not-a-date' } },
      { topic: 'x', timeRange: { start: '2026-02-31' } },
      { topic: 'x', timeRange: { start: '2026-02-01', end: '2026-01-01' } },
      { topic: 'x', limit: 0 },
      { topic: 'x', limit: 51 },
    ];
    for (const body of invalidBodies) await responseBody(await post(baseUrl, body, 'service-key'), 400);
    assert.equal(calls.length, 0);

    await responseBody(await post(baseUrl, { topic: 'x', timeRange: { start: '2026-01-01', end: '2026-02-01' }, limit: 50 }, 'service-key'), 200);
    assert.equal(calls.length, 1);
  });
}

async function testStatusMappingAndErrorSanitization() {
  process.env.SOURCE_RECALL_API_ENABLED = 'true';
  process.env.SOURCE_RECALL_API_KEY = 'service-key';
  process.env.SOURCE_RECALL_RATE_LIMIT_PER_MINUTE = '1000';
  const results = [
    retrievalResult({ sources: [], diagnostics: diagnostics({ acceptedCount: 0, mergedCandidateCount: 0 }) }),
    retrievalResult({ diagnostics: diagnostics({ retrieverErrors: [{ source: 'vector', message: 'relation secret_table missing at https://provider.invalid?key=secret' }] }) }),
    retrievalResult({ sources: [], diagnostics: diagnostics({
      acceptedCount: 0,
      retrieverErrors: ['vector', 'fulltext', 'title', 'entity'].map((source) => ({ source: source as 'vector', message: 'internal database error' })),
    }) }),
    retrievalResult({ diagnostics: diagnostics({
      retrieverErrors: ['vector', 'fulltext', 'title', 'entity'].map((source) => ({ source: source as 'vector', message: 'first pass timed out, expanded pass recovered' })),
    }) }),
  ];
  await withApi(async () => results.shift() || retrievalResult(), async (baseUrl) => {
    assert.equal((await responseBody(await post(baseUrl, { topic: 'empty' }, 'service-key'), 200)).status, 'empty');
    const fallback = await responseBody(await post(baseUrl, { topic: 'fallback' }, 'service-key'), 200);
    assert.equal(fallback.status, 'fallback');
    assert.deepEqual(fallback.diagnostics.retrieverErrors, [{ source: 'vector', message: 'vector retrieval unavailable' }]);
    assert.doesNotMatch(JSON.stringify(fallback), /secret_table|provider\.invalid|key=secret/);
    assert.equal((await responseBody(await post(baseUrl, { topic: 'unavailable' }, 'service-key'), 200)).status, 'unavailable');
    assert.equal((await responseBody(await post(baseUrl, { topic: 'recovered' }, 'service-key'), 200)).status, 'fallback');
  });
}

async function testRateAndConcurrencyLimits() {
  process.env.SOURCE_RECALL_API_ENABLED = 'true';
  process.env.SOURCE_RECALL_API_KEY = 'service-key';
  process.env.SOURCE_RECALL_RATE_LIMIT_PER_MINUTE = '60';
  const rateAccess = new SourceRecallAccessService();
  for (let index = 0; index < 60; index += 1) rateAccess.authorize('service-key');
  assert.throws(() => rateAccess.authorize('service-key'), (error: unknown) => (
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 429)
  ));

  await withApi(async () => retrievalResult(), async (baseUrl) => {
    const responses: Response[] = [];
    for (let index = 0; index < 61; index += 1) responses.push(await post(baseUrl, { topic: 'rate test' }, 'service-key'));
    const limited = responses[60];
    assert.equal(limited?.status, 429);
    assert.equal(limited?.headers.get('ratelimit-limit'), '60');
    assert.equal(limited?.headers.get('ratelimit-remaining'), '0');
    assert.ok(Number(limited?.headers.get('retry-after')) > 0);
    assert.equal(limited?.headers.get('cache-control'), 'no-store');
  });

  process.env.SOURCE_RECALL_MAX_CONCURRENCY = '4';
  const concurrentAccess = new SourceRecallAccessService();
  let release = () => undefined;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const active = Array.from({ length: 4 }, () => concurrentAccess.withConcurrency(() => blocker));
  await assert.rejects(() => concurrentAccess.withConcurrency(async () => undefined), (error: unknown) => (
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 429)
  ));
  release();
  await Promise.all(active);
}

async function testIsolationFromReportJobsAndArtifacts() {
  const serviceSource = await readFile(new URL('../server/source-recall.service.ts', import.meta.url), 'utf8');
  const controllerSource = await readFile(new URL('../server/source-recall.controller.ts', import.meta.url), 'utf8');
  const appModuleSource = await readFile(new URL('../server/source-recall.module.ts', import.meta.url), 'utf8');
  const deployScript = await readFile(new URL('../scripts/provision-source-recall.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(serviceSource, /ReportsService|RemoteFileService|ArtifactStorage|mkdir|writeFile/);
  assert.doesNotMatch(controllerSource, /ReportsService|AuthGuard|PermissionsGuard/);
  assert.match(appModuleSource, /SourceRecallController/);
  assert.doesNotMatch(appModuleSource, /VectorSourceService|ReportsService|RetrievalModule/);
  for (const name of [
    'SOURCE_RECALL_API_ENABLED',
    'SOURCE_RECALL_API_KEY',
    'SOURCE_RECALL_CLIENT_ID',
    'SOURCE_RECALL_RATE_LIMIT_PER_MINUTE',
    'SOURCE_RECALL_MAX_CONCURRENCY',
  ]) assert.match(deployScript, new RegExp(name));
  assert.doesNotMatch(deployScript, /gaogao-api.*SOURCE_RECALL|SOURCE_RECALL.*gaogao-api/);
}

function testExternalLimitAndMetadataOnlyAudit() {
  const profile: QueryProfile = {
    originalQuery: 'limit test',
    supplement: '',
    coreEntities: [],
    coreTopics: ['limit'],
    queryVariants: ['limit test'],
  };
  const candidates: RetrievalCandidate[] = Array.from({ length: 30 }, (_, index) => ({
    documentId: `doc-${index}`,
    title: `Source ${index}`,
    retrievalSources: ['fulltext'],
    ranks: { fulltext: index + 1 },
    scores: { final: 0.9, fulltext: 0.9 },
  }));
  const policy = new CandidatePolicyService(DEFAULT_RETRIEVAL_CONFIG, new EntityMatchService());
  assert.equal(policy.evaluate(candidates, profile, 'normal').accepted.length, 12);
  assert.equal(policy.evaluate(candidates, profile, 'normal', 20).accepted.length, 20);
  assert.equal(policy.evaluate(candidates, profile, 'normal', 50).accepted.length, 30);

  const cleanInput: CleanRetrievalInput = {
    reportJobId: 'external:other-project:trace-id',
    topic: 'sensitive topic',
    supplement: 'sensitive background',
    explicitEntities: [{ name: 'sensitive entity', required: true }],
  };
  const metadataOnly = (
    RetrievalOrchestratorService.prototype as unknown as {
      metadataOnlyAuditInput: (request: CleanRetrievalInput) => unknown;
    }
  ).metadataOnlyAuditInput(cleanInput);
  const serialized = JSON.stringify(metadataOnly);
  assert.match(serialized, /external:other-project:trace-id/);
  assert.match(serialized, /external-source-recall/);
  assert.doesNotMatch(serialized, /sensitive topic|sensitive background|sensitive entity/);
}

try {
  await testAuthenticationAndSuccessfulContract();
  await testValidationBoundaries();
  await testStatusMappingAndErrorSanitization();
  await testRateAndConcurrencyLimits();
  await testIsolationFromReportJobsAndArtifacts();
  testExternalLimitAndMetadataOnlyAudit();
  console.log('source recall API tests passed');
} finally {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('SOURCE_RECALL_API_ENABLED', originalEnvironment.enabled);
  restore('SOURCE_RECALL_API_KEY', originalEnvironment.key);
  restore('SOURCE_RECALL_CLIENT_ID', originalEnvironment.clientId);
  restore('SOURCE_RECALL_RATE_LIMIT_PER_MINUTE', originalEnvironment.rate);
  restore('SOURCE_RECALL_MAX_CONCURRENCY', originalEnvironment.concurrency);
}
