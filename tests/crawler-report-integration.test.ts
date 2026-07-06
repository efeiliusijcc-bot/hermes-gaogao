import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HermesService } from '../server/hermes.service.js';
import { ReportsService } from '../server/reports.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

function logText(entry: Record<string, unknown>): string {
  return [entry.summary, entry.detail, entry.command, entry.toolDisplayName].filter(Boolean).join(' ');
}

function user(id: string, role: AuthUser['role'] = 'operator'): AuthUser {
  return { id, username: `${role}-${id}`, displayName: '', email: null, role, roles: [role], permissions: ['report:read', 'report:update'] };
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
      if (!(path in files)) throw new Error(`missing file: ${path}`);
      return files[path];
    },
    exists: async (path: string) => path in files,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function makeJob(payloadContext: Record<string, unknown> = {}) {
  return {
    jobId: 'job-crawler-integration',
    skill: 'write-hb',
    payload: {
      topic: '英国未成年人社交媒体禁令',
      report_type: 'K报',
      known_context: JSON.stringify(payloadContext),
    },
    ownerUserId: 'user-1',
    ownerUsername: 'operator-user-1',
    ownerRole: 'operator',
    status: 'running',
    artifacts: {},
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    events: [],
    eventLog: [],
  };
}

function createReportsService(crawler?: Record<string, unknown>, files?: Record<string, string>) {
  const remoteFs = remoteFsStub(files);
  const service = new ReportsService({} as never, remoteFs as never, {} as never, undefined, crawler as never) as ReportsService & {
    enrichPayloadWithCrawlerSources: (job: ReturnType<typeof makeJob>, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
    jobs: Map<string, ReturnType<typeof makeJob>>;
  };
  return { service, remoteFs };
}

async function testCrawlerPlanDisabledDoesNotCallCrawlerAndPreservesContext() {
  let crawlerCalls = 0;
  const crawler = {
    createTask: async () => {
      crawlerCalls += 1;
      throw new Error('should not be called');
    },
  };
  const context = {
    report_plan: { title: '用户确认提纲' },
    database_sources: [{ title: '数据库材料' }],
    draftAssistantContext: { outline: '拟稿助手提纲' },
    userPreferenceContext: { style: '简洁正式' },
    crawlerPlan: {
      enabled: false,
      mode: 'manual',
      goal: '保留禁用计划',
      manualUrls: ['https://example.com/source'],
      maxPages: 12,
      maxDepth: 1,
      executePhase: 'research',
    },
  };
  const job = makeJob(context);
  const { service, remoteFs } = createReportsService(crawler);
  const result = await service.enrichPayloadWithCrawlerSources(job, job.payload as Record<string, unknown>);
  const nextContext = JSON.parse(String(result.known_context));

  assert.equal(crawlerCalls, 0);
  assert.equal(nextContext.crawlerPlan.enabled, false);
  assert.equal(nextContext.crawlerPlan.goal, '保留禁用计划');
  assert.deepEqual(nextContext.crawlerPlan.manualUrls, ['https://example.com/source']);
  assert.deepEqual(nextContext.crawlerSourceContext, { tasks: [], items: [] });
  assert.deepEqual(nextContext.database_sources, context.database_sources);
  assert.deepEqual(nextContext.report_plan, context.report_plan);
  assert.deepEqual(nextContext.draftAssistantContext, context.draftAssistantContext);
  assert.deepEqual(nextContext.userPreferenceContext, context.userPreferenceContext);
  assert.ok(job.eventLog.some((entry) => logText(entry).includes('资料采集工具：跳过，crawlerPlan.enabled=false')));
  assert.ok(remoteFs.writes.some((write) => write.path.endsWith('/context.json') && write.content.includes('"crawlerPlan"')));
}

async function testCrawlerPlanEnabledWritesCrawlerSourceContextAndSources() {
  const crawler = {
    createTask: async () => ({
      taskId: 'task-1',
      status: 'pending',
      goal: '补充公开资料',
      itemCount: 0,
    }),
    runTask: async () => ({
      task: {
        taskId: 'task-1',
        status: 'completed',
        goal: '补充公开资料',
      },
      items: [{
        itemId: 'item-1',
        title: 'UK online safety update',
        url: 'https://example.com/uk-online-safety',
        publisher: 'Example News',
        publishedAt: '2026-07-05T00:00:00.000Z',
        fetchedAt: '2026-07-06T00:00:00.000Z',
        contentSummary: '英国网络安全政策更新。',
        contentText: '英国网络安全政策更新全文摘要。',
        relevanceScore: 80,
        credibilityScore: 75,
      }],
    }),
  };
  const context = {
    report_plan: { title: '用户确认提纲' },
    database_sources: [{ title: '数据库材料' }],
    draftAssistantContext: { outline: '拟稿助手提纲' },
    userPreferenceContext: { style: '简洁正式' },
    crawlerPlan: {
      enabled: true,
      mode: 'hybrid',
      goal: '补充英国未成年人社交媒体禁令相关公开资料',
      manualUrls: ['https://example.com/uk-online-safety'],
      maxPages: 10,
      maxDepth: 1,
      executePhase: 'research',
    },
  };
  const job = makeJob(context);
  const { service, remoteFs } = createReportsService(crawler);
  const result = await service.enrichPayloadWithCrawlerSources(job, job.payload as Record<string, unknown>);
  const nextContext = JSON.parse(String(result.known_context));

  assert.equal(nextContext.crawlerSourceContext.tasks[0].taskId, 'task-1');
  assert.equal(nextContext.crawlerSourceContext.items[0].sourceType, 'crawler');
  assert.equal(nextContext.crawlerSourceContext.items[0].publisher, 'Example News');
  assert.deepEqual(nextContext.database_sources, context.database_sources);
  assert.deepEqual(nextContext.report_plan, context.report_plan);
  assert.deepEqual(nextContext.draftAssistantContext, context.draftAssistantContext);
  assert.deepEqual(nextContext.userPreferenceContext, context.userPreferenceContext);
  assert.ok(job.eventLog.some((entry) => logText(entry).includes('资料采集工具：已创建采集任务')));
  assert.ok(job.eventLog.some((entry) => logText(entry).includes('资料采集工具：采集完成，获得 1 条来源')));
  assert.ok(job.events.some((entry) => entry.type === 'sources' && JSON.stringify(entry).includes('资料采集')));
  assert.ok(remoteFs.writes.some((write) => write.path.endsWith('/crawler/crawler_sources.json') && write.content.includes('"sourceType": "crawler"')));
}

async function testSourceOverviewDistinguishesCrawlerSources() {
  const crawlerContext = {
    tasks: [{ taskId: 'task-1', status: 'completed', goal: '补充公开资料', itemCount: 1 }],
    items: [{
      itemId: 'item-1',
      title: 'Collected source',
      url: 'https://example.com/source',
      publisher: 'Example',
      fetchedAt: '2026-07-06T00:00:00.000Z',
      contentSummary: '采集摘要',
      contentText: '采集正文',
      sourceType: 'crawler',
      relevanceScore: 80,
      credibilityScore: 70,
    }],
  };
  const files = {
    '/tmp/hermes-reports/job-crawler-integration/context.json': JSON.stringify({ crawlerSourceContext: crawlerContext }),
    '/tmp/hermes-reports/job-crawler-integration/crawler/crawler_sources.json': JSON.stringify(crawlerContext),
  };
  const job = makeJob({ crawlerSourceContext: crawlerContext });
  job.status = 'succeeded';
  job.artifacts = { hermesJobDir: '/tmp/hermes-reports/job-crawler-integration' };
  const { service } = createReportsService(undefined, files);
  service.jobs.set(job.jobId, job);

  const result = await service.getSources(job.jobId, { type: 'crawler', pageSize: 10 }, user('user-1'));
  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0].sourceGroup, 'crawler');
  assert.equal(result?.items[0].sourceType, '资料采集');
  assert.equal(result?.meta?.summary && (result.meta.summary as Record<string, unknown>).crawlerCount, 1);
}

function testHermesPromptContainsCrawlerAndSynthesisConstraints() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    buildReportPrompt: (input: Record<string, unknown>) => string;
    getSkillRequirements: (input: Record<string, unknown>) => string[];
  };
  const input = {
    skill: 'write-hb',
    jobId: 'job-crawler-integration',
    payload: {
      topic: '英国未成年人社交媒体禁令',
      report_type: 'K报',
      known_context: JSON.stringify({
        databaseSourceOptions: { enabled: true },
        crawlerPlan: { enabled: true, manualUrls: ['https://example.com/source'] },
      }),
    },
  };
  const prompt = hermes.buildReportPrompt(input);
  assert.match(prompt, /source-collection-agent/);
  assert.match(prompt, /controlled-web-collector/);
  assert.match(prompt, /crawler\.create_task、crawler\.run_task、crawler\.get_items/);
  assert.match(prompt, /严禁让模型自由执行 Python、shell/);
  assert.match(prompt, /数据库信源优先/);
  assert.match(prompt, /资料采集信源作为补充/);
  assert.match(prompt, /URL \/ publisher \/ fetchedAt/);

  const disabledRequirements = hermes.getSkillRequirements({
    ...input,
    payload: {
      ...input.payload,
      known_context: JSON.stringify({ crawlerPlan: { enabled: false } }),
    },
  }).join('\n');
  assert.match(disabledRequirements, /不得调用 controlled-web-collector/);
}

function testControlledWebCollectorSkillForbidsArbitraryExecution() {
  const skillText = fs.readFileSync('/Users/a15070743048/Desktop/hermes/skills/controlled-web-collector/SKILL.md', 'utf8');
  assert.match(skillText, /never executes Python, shell commands/i);
  assert.match(skillText, /crawler\.create_task/);
  assert.match(skillText, /crawler\.run_task/);
  assert.match(skillText, /crawler\.get_items/);
  assert.match(skillText, /No localhost/);
}

await testCrawlerPlanDisabledDoesNotCallCrawlerAndPreservesContext();
await testCrawlerPlanEnabledWritesCrawlerSourceContextAndSources();
await testSourceOverviewDistinguishesCrawlerSources();
testHermesPromptContainsCrawlerAndSynthesisConstraints();
testControlledWebCollectorSkillForbidsArbitraryExecution();

console.log('crawler report integration tests passed');
