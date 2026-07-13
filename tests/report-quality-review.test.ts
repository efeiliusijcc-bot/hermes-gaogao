import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';
import { PermissionsGuard } from '../server/permissions.guard.js';
import { ReportsController } from '../server/reports.controller.js';
import { ReportsService } from '../server/reports.service.js';

type Query = { text: string; params?: unknown[] };

function user(id: string, role: AuthUser['role'], permissions: string[] = ['report:read']): AuthUser {
  return { id, username: `${role}-${id}`, displayName: '', email: null, role, roles: [role], permissions };
}

function remoteFsStub(files: Record<string, string> = {}) {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => {
      writes.push({ path, content });
      files[path] = content;
    },
    readFile: async (path: string) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
    exists: async (path: string) => path in files,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function makeJob(ownerUserId = 'user-1') {
  const markdown = [
    '# 英国未成年人社交媒体禁令报告',
    '',
    '## 一、基本情况',
    '英国政府推动未成年人社交媒体监管，涉及监管机构、平台企业和学校等主体。',
    '',
    '## 二、涉我风险',
    '该政策可能影响中资平台合规成本，风险判断主要基于公开监管文件和媒体报道。',
    '',
    '## 三、对策建议',
    '建议持续跟踪官方公告、企业表态和监管执行细则。',
    '',
    '## 四、参考资料',
    '[1] 数据库材料，政府网站，2026年7月5日。',
  ].join('\n');
  return {
    jobId: 'quality-job-1',
    skill: 'write-hb',
    payload: {
      topic: '英国未成年人社交媒体禁令',
      report_type: 'K报',
      known_context: JSON.stringify({
        report_plan: { sections: ['基本情况', '涉我风险', '对策建议'] },
        draftAssistantContext: { outline: '拟稿助手提纲' },
        userPreferenceContext: { style: '简洁正式' },
        webSources: [{ title: '互联网材料', sourceType: 'web', url: 'https://example.com' }],
      }),
    },
    ownerUserId,
    ownerUsername: ownerUserId || '',
    ownerRole: 'operator',
    status: 'succeeded',
    markdown,
    resultPath: '/tmp/hermes-reports/quality-job-1/final/report.md',
    artifacts: { hermesJobDir: '/tmp/hermes-reports/quality-job-1' },
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    events: [],
    eventLog: [],
  };
}

function makeReviewRow(overrides: Record<string, unknown> = {}) {
  const reviewJson = {
    overallScore: 82,
    summary: '报告整体围绕主题展开。',
    wordCount: 180,
    scores: {
      factualClarity: 85,
      planAlignment: 82,
      sourceQuality: 80,
      attitudeTraceability: 70,
      riskReasoning: 78,
      writingQuality: 86,
    },
    checks: [{ key: 'topic_alignment', label: '主题一致性', status: 'pass', comment: '主题一致。' }],
    issues: [{
      severity: 'warning',
      section: '各方态度',
      problem: '部分表态未标注具体媒体和时间。',
      evidence: '文中出现“多方认为”。',
      suggestion: '补充表态主体、发布时间、媒体名称和来源链接。',
      targetText: '多方认为该政策将引发争议。',
    }],
    recommendedEdits: [{ section: '各方态度', editMode: 'add_sources', instruction: '请补充表态主体、时间、媒体和来源。' }],
    sourceUsage: { databaseSourcesUsed: 1, internetSourcesUsed: 1, unverifiedClaims: 0 },
  };
  return {
    review_id: 'review-1',
    job_id: 'quality-job-1',
    owner_id: 'user-1',
    status: 'completed',
    overall_score: 82,
    factual_clarity_score: 85,
    plan_alignment_score: 82,
    source_quality_score: 80,
    attitude_traceability_score: 70,
    risk_reasoning_score: 78,
    writing_quality_score: 86,
    word_count: 180,
    review_json: reviewJson,
    error_message: null,
    created_at: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

function createPool() {
  const queries: Query[] = [];
  let latestRow = makeReviewRow();
  const inserted: Record<string, unknown>[] = [];
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('SELECT review_id') && text.includes('FROM report_quality_reviews')) {
        return { rows: latestRow ? [latestRow] : [] };
      }
      if (text.includes('INSERT INTO report_quality_reviews')) {
        const reviewJson = JSON.parse(String(params?.[10] || '{}'));
        latestRow = makeReviewRow({
          review_id: 'review-inserted',
          job_id: params?.[0],
          owner_id: params?.[1],
          status: params?.[2],
          overall_score: params?.[3],
          factual_clarity_score: params?.[4],
          plan_alignment_score: params?.[5],
          source_quality_score: params?.[6],
          attitude_traceability_score: params?.[7],
          risk_reasoning_score: params?.[8],
          writing_quality_score: params?.[9],
          review_json: reviewJson,
          word_count: reviewJson.wordCount,
          error_message: params?.[11] ?? null,
        });
        inserted.push(latestRow);
        return { rows: [latestRow] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
  return { pool, queries, inserted };
}

function createService(pool = createPool(), files: Record<string, string> = {}) {
  const remoteFs = remoteFsStub({
    '/tmp/hermes-reports/quality-job-1/final/report.md': makeJob().markdown || '',
    '/tmp/hermes-reports/quality-job-1/context.json': String(makeJob().payload.known_context),
    '/tmp/hermes-reports/quality-job-1/database/database_sources.json': JSON.stringify([{ title: '数据库材料' }]),
    '/tmp/hermes-reports/quality-job-1/crawler/crawler_sources.json': JSON.stringify({ items: [{ title: '采集材料', sourceType: 'crawler' }] }),
    ...files,
  });
  const service = new ReportsService({} as never, remoteFs as never, {} as never) as ReportsService & {
    getPool: () => Promise<typeof pool.pool>;
    jobs: Map<string, ReturnType<typeof makeJob>>;
    runQualityReviewForJob: (job: ReturnType<typeof makeJob>) => Promise<unknown>;
    buildReportEditPayloadFromQualityIssue: (issue: Record<string, unknown>) => Record<string, unknown>;
  };
  service.getPool = async () => pool.pool;
  service.jobs.set('quality-job-1', makeJob());
  return { service, remoteFs, pool };
}

function assertScoreRange(value: unknown) {
  assert.equal(typeof value, 'number');
  assert.ok((value as number) >= 0 && (value as number) <= 100);
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) return JSON.stringify((error as { response?: unknown }).response);
  return error instanceof Error ? error.message : String(error);
}

async function testOwnerAdminIsolation() {
  const { service } = createService();
  const ownerResult = await service.getQualityReview('quality-job-1', user('user-1', 'operator'));
  assert.equal(ownerResult?.reviewId, 'review-1');
  await assert.rejects(
    () => service.getQualityReview('quality-job-1', user('user-2', 'operator')),
    (error) => /Insufficient report job permissions/.test(errorText(error)),
  );
  const adminResult = await service.getQualityReview('quality-job-1', user('admin-1', 'admin'));
  assert.equal(adminResult?.overallScore, 82);
}

async function testRunQualityReviewWritesStructuredResultAndDoesNotOverwriteReport() {
  const { service, remoteFs, pool } = createService();
  const originalMarkdown = makeJob().markdown;
  const result = await service.runQualityReview('quality-job-1', user('user-1', 'operator'));
  assert.equal(result.status, 'completed');
  assertScoreRange(result.overallScore);
  assert.ok(pool.inserted.length >= 1);
  assert.ok(remoteFs.writes.some((write) => write.path.endsWith('/quality/quality_review.json')));
  assert.equal(remoteFs.writes.some((write) => write.path.endsWith('/final/report.md') && write.content !== originalMarkdown), false);
  const reviewJson = pool.inserted[0].review_json as Record<string, unknown>;
  assert.ok(reviewJson.scores && typeof reviewJson.scores === 'object');
  assert.ok(Array.isArray(reviewJson.checks));
  assert.ok(Array.isArray(reviewJson.issues));
}

async function testQualityReviewFailureDoesNotChangeSucceededJob() {
  const pool = createPool();
  const { service } = createService(pool, { '/tmp/hermes-reports/quality-job-1/final/report.md': '' });
  const job = service.jobs.get('quality-job-1')!;
  job.markdown = '';
  await service.runQualityReviewForJob(job);
  assert.equal(job.status, 'succeeded');
  assert.ok(pool.inserted.length >= 1);
  assert.equal(pool.inserted[0].status, 'failed');
}

function testQualityIssueCanBecomeReportEditPayload() {
  const { service } = createService();
  const payload = service.buildReportEditPayloadFromQualityIssue({
    section: '各方态度',
    targetText: '多方认为该政策将引发争议。',
    suggestion: '补充表态主体、发布时间、媒体名称和来源链接。',
  });
  assert.equal(payload.targetType, 'selected_text');
  assert.equal(payload.originalText, '多方认为该政策将引发争议。');
  assert.equal(payload.editMode, 'add_sources');
  assert.match(String(payload.instruction), /补充表态主体/);
}

async function testHttpEndpoints() {
  const usersByToken: Record<string, AuthUser> = {
    owner: user('user-1', 'operator'),
    other: user('user-2', 'operator'),
    admin: user('admin-1', 'admin'),
  };

  @Module({
    controllers: [ReportsController],
    providers: [
      Reflector,
      {
        provide: AuthService,
        useValue: {
          verifyAccessToken: async (token: string) => {
            const found = usersByToken[token];
            if (!found) throw new Error('invalid token');
            return found;
          },
        },
      },
      { provide: AuthGuard, useFactory: (auth: AuthService) => new AuthGuard(auth), inject: [AuthService] },
      { provide: PermissionsGuard, useFactory: (reflector: Reflector) => new PermissionsGuard(reflector), inject: [Reflector] },
      {
        provide: ReportsService,
        useValue: {
          getQualityReview: async (_jobId: string, currentUser: AuthUser) => {
            if (currentUser.id === 'user-2') throw new Error('Insufficient report job permissions');
            return { reviewId: 'review-1', status: 'completed', overallScore: 82 };
          },
          runQualityReview: async () => ({ reviewId: 'review-rerun', status: 'completed', overallScore: 80 }),
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/api/report-jobs/quality-job-1/quality-review`;
  try {
    const getResponse = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
    assert.equal(getResponse.status, 200, await getResponse.text());
    const postResponse = await fetch(`${url}/run`, { method: 'POST', headers: { Authorization: 'Bearer owner' } });
    assert.equal(postResponse.status, 201, await postResponse.text());
  } finally {
    await app.close();
  }
}

await testOwnerAdminIsolation();
await testRunQualityReviewWritesStructuredResultAndDoesNotOverwriteReport();
await testQualityReviewFailureDoesNotChangeSucceededJob();
testQualityIssueCanBecomeReportEditPayload();
await testHttpEndpoints();

console.log('report quality review tests passed');
