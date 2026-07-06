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
    getPool: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }>;
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

async function testPlanningSelectedCrawlerItemsSkipResearchCollection() {
  let crawlerCalls = 0;
  const crawler = {
    createTask: async () => {
      crawlerCalls += 1;
      throw new Error('should not create crawler task during research');
    },
  };
  const context = {
    report_plan: { title: '用户确认提纲' },
    database_sources: [{ title: '数据库材料' }],
    draftAssistantContext: { outline: '拟稿助手提纲' },
    userPreferenceContext: { style: '简洁正式' },
    crawlerPlan: {
      enabled: true,
      executePhase: 'planning',
      alreadyExecuted: true,
      allowFurtherCollectionInResearch: false,
      mode: 'hybrid',
      goal: '规划页已采集资料',
    },
    crawlerTaskIds: ['task-planning-1'],
    selectedCrawlerItemIds: ['item-selected-1'],
    crawlerSourceContext: {
      source: 'planning_selected_sources',
      tasks: [{ taskId: 'task-planning-1', status: 'completed', itemCount: 2, selectedCount: 1 }],
      items: [{ itemId: 'item-selected-1', title: '前端已选摘要', sourceType: 'crawler', sourcePhase: 'planning' }],
    },
  };
  const job = makeJob(context);
  const { service, remoteFs } = createReportsService(crawler);
  service.getPool = async () => ({
    query: async (text: string, params?: unknown[]) => {
      if (text.includes('FROM crawler_items')) {
        assert.deepEqual(params, [['item-selected-1'], 'user-1']);
        return {
          rows: [{
            item_id: 'item-selected-1',
            task_id: 'task-planning-1',
            owner_id: 'user-1',
            job_id: '',
            url: 'https://example.com/selected',
            title: 'Selected Planning Source',
            publisher: 'Example',
            published_at: null,
            fetched_at: '2026-07-06T00:00:00.000Z',
            content_text: '完整采集正文',
            content_summary: '已选采集摘要',
            metadata: { sourcePhase: 'planning' },
            relevance_score: 88,
            credibility_score: 91,
            created_at: '2026-07-06T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
  });
  const result = await service.enrichPayloadWithCrawlerSources(job, job.payload as Record<string, unknown>);
  const nextContext = JSON.parse(String(result.known_context));

  assert.equal(crawlerCalls, 0);
  assert.equal(nextContext.crawlerPlan.executePhase, 'planning');
  assert.equal(nextContext.crawlerPlan.alreadyExecuted, true);
  assert.deepEqual(nextContext.selectedCrawlerItemIds, ['item-selected-1']);
  assert.equal(nextContext.crawlerSourceContext.source, 'planning_selected_sources');
  assert.equal(nextContext.crawlerSourceContext.items.length, 1);
  assert.equal(nextContext.crawlerSourceContext.items[0].itemId, 'item-selected-1');
  assert.equal(nextContext.crawlerSourceContext.items[0].sourcePhase, 'planning');
  assert.deepEqual(nextContext.database_sources, context.database_sources);
  assert.deepEqual(nextContext.report_plan, context.report_plan);
  assert.deepEqual(nextContext.draftAssistantContext, context.draftAssistantContext);
  assert.deepEqual(nextContext.userPreferenceContext, context.userPreferenceContext);
  assert.ok(job.eventLog.some((entry) => logText(entry).includes('资料采集工具：使用规划页面已选择的 1 条采集信源')));
  assert.ok(remoteFs.writes.some((write) => write.path.endsWith('/context.json') && write.content.includes('"sourcePhase": "planning"')));
}

async function testPlanningCrawlerDoesNotIncludeUnselectedFallbackItems() {
  const context = {
    crawlerPlan: {
      enabled: true,
      executePhase: 'planning',
      alreadyExecuted: true,
      allowFurtherCollectionInResearch: false,
    },
    selectedCrawlerItemIds: [],
    crawlerSourceContext: {
      source: 'planning_selected_sources',
      tasks: [{ taskId: 'task-planning-1', status: 'completed', itemCount: 2, selectedCount: 0 }],
      items: [
        { itemId: 'item-not-selected-1', title: '不应带入 1', sourceType: 'crawler', sourcePhase: 'planning' },
        { itemId: 'item-not-selected-2', title: '不应带入 2', sourceType: 'crawler', sourcePhase: 'planning' },
      ],
    },
  };
  const job = makeJob(context);
  const { service } = createReportsService({
    createTask: async () => {
      throw new Error('should not create crawler task during research');
    },
  });
  service.getPool = async () => ({
    query: async () => ({ rows: [] }),
  });
  const result = await service.enrichPayloadWithCrawlerSources(job, job.payload as Record<string, unknown>);
  const nextContext = JSON.parse(String(result.known_context));
  assert.deepEqual(nextContext.selectedCrawlerItemIds, []);
  assert.equal(nextContext.crawlerSourceContext.items.length, 0);
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
      sourcePhase: 'planning',
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
  assert.equal(result?.items[0].method, '规划页面已选');
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

function testHermesPromptForPlanningSelectedCrawlerSkipsResearchCollection() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    getSkillRequirements: (input: Record<string, unknown>) => string[];
  };
  const requirements = hermes.getSkillRequirements({
    skill: 'write-hb',
    jobId: 'job-crawler-integration',
    payload: {
      topic: '英国未成年人社交媒体禁令',
      report_type: 'K报',
      known_context: JSON.stringify({
        crawlerPlan: {
          enabled: true,
          executePhase: 'planning',
          alreadyExecuted: true,
          allowFurtherCollectionInResearch: false,
        },
        crawlerSourceContext: {
          source: 'planning_selected_sources',
          items: [{ itemId: 'item-selected-1', sourcePhase: 'planning' }],
        },
      }),
    },
  }).join('\n');
  assert.match(requirements, /不得调用 source-collection-agent/);
  assert.match(requirements, /规划页面已选择的采集信源/);
  assert.match(requirements, /不得伪造或扩大 selectedCrawlerItemIds/);
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
await testPlanningSelectedCrawlerItemsSkipResearchCollection();
await testPlanningCrawlerDoesNotIncludeUnselectedFallbackItems();
await testSourceOverviewDistinguishesCrawlerSources();
testHermesPromptContainsCrawlerAndSynthesisConstraints();
testHermesPromptForPlanningSelectedCrawlerSkipsResearchCollection();
testControlledWebCollectorSkillForbidsArbitraryExecution();

console.log('crawler report integration tests passed');
