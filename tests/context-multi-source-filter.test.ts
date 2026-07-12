import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';
import { buildRuleBasedEntityPolicy } from '../server/entity-policy.js';

function remoteFsStub() {
  const files: Record<string, string> = {};
  const writes: Array<{ path: string; content: string }> = [];
  return {
    files,
    writes,
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => { files[path] = content; writes.push({ path, content }); },
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

async function testContextContainsAcceptedSourcesOnly() {
  const topic = 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向';
  const policy = buildRuleBasedEntityPolicy({ topic });
  const officialBody = 'Neo Performance Materials official Magnequench production process, pilot-scale validation and mass production readiness update. '.repeat(3);
  const crawlerBody = 'Magnequench production process improvement, pilot line trials and mass production preparation are described in detail. '.repeat(3);
  const webSupplement = {
    search: async () => [
      {
        title: 'Magnequench official production update',
        url: 'https://neo.example/official-update',
        summary: '麦格昆磁生产工艺、中试和量产进展。',
        content: officialBody,
        publisher: 'Neo official',
        publishedAt: '2026-07-01',
        sourceType: 'web', engine: 'tavily', query: 'Magnequench production', searchScore: 0.9,
      },
      {
        title: 'Magnequench pilot line report',
        url: 'https://industry.example/crawler-needed',
        summary: 'Magnequench pilot production and mass production update.',
        content: '',
        publisher: 'Industry News',
        publishedAt: '2026-07-01',
        sourceType: 'web', engine: 'tavily', query: 'Magnequench production', searchScore: 0.85,
      },
      {
        title: 'Micron Technology earnings outlook',
        url: 'https://market.example/micron',
        summary: '美光 Micron DRAM NAND 财报。',
        content: 'Micron Technology DRAM NAND earnings and stock commentary. '.repeat(4),
        publisher: 'Market Blog',
        publishedAt: '2026-07-01',
        sourceType: 'web', engine: 'tavily', query: 'Magnequench production', searchScore: 0.99,
      },
    ],
  };
  const crawler = {
    createTask: async () => ({ taskId: 'supplement-task' }),
    runTask: async () => ({
      task: { taskId: 'supplement-task' },
      items: [{
        itemId: 'crawler-item-1', taskId: 'supplement-task', url: 'https://industry.example/crawler-needed',
        title: 'Magnequench pilot line report', publisher: 'Industry Technology News', publishedAt: '2026-07-01',
        fetchedAt: '2026-07-10', contentSummary: 'Magnequench pilot and mass production.', contentText: crawlerBody,
        metadata: {}, relevanceScore: 85, credibilityScore: 75,
      }],
    }),
  };
  const remoteFs = remoteFsStub();
  const service = new ReportsService(
    {} as never,
    remoteFs as never,
    {} as never,
    undefined,
    crawler as never,
    webSupplement as never,
  ) as unknown as {
    enrichPayloadWithWebSupplement(job: Record<string, unknown>, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  const context = {
    topic,
    entityPolicy: policy,
    databaseSourceOptions: { enabled: true },
    webSearchOptions: { enabled: true },
    crawlerPlan: { enabled: true, executePhase: 'research' },
    vectorDatabaseSources: [{
      title: 'Magnequench database material', url: 'https://database.example/mq',
      summary: '麦格昆磁生产工艺、中试和量产数据库材料。', websiteName: 'Database', relevanceScore: 0.86,
    }],
    crawlerSourceContext: { tasks: [], items: [] },
    sourceDiagnostics: { database: { acceptedCount: 1 } },
  };
  const job = {
    jobId: 'job-context-multi-source', skill: 'write-hb', payload: { topic, known_context: JSON.stringify(context) },
    ownerUserId: 'user-1', ownerUsername: 'operator', status: 'running', artifacts: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [], eventLog: [],
  };
  const output = await service.enrichPayloadWithWebSupplement(job, job.payload as Record<string, unknown>);
  const finalContext = JSON.parse(String(output.known_context));
  assert.equal(finalContext.vectorDatabaseSources.length, 1);
  assert.equal(finalContext.webSources.length, 1);
  assert.equal(finalContext.crawlerSourceContext.items.length, 1);
  assert.doesNotMatch(JSON.stringify({
    database: finalContext.vectorDatabaseSources,
    web: finalContext.webSources,
    crawler: finalContext.crawlerSourceContext.items,
  }), /Micron|美光|DRAM|NAND/);
  assert.equal(finalContext.sourceDiagnostics.supplement.triggered, true);
  assert.equal(finalContext.sourceDiagnostics.supplement.acceptedCount, 2);

  const diagnostics = remoteFs.writes.find((item) => item.path.endsWith('/web_supplement_diagnostics.json'));
  assert.match(diagnostics?.content || '', /Micron|美光/);
  const contextWrite = remoteFs.writes.find((item) => item.path.endsWith('/context.json'));
  const savedContext = JSON.parse(contextWrite?.content || '{}');
  assert.doesNotMatch(JSON.stringify({
    database: savedContext.vectorDatabaseSources,
    web: savedContext.webSources,
    crawler: savedContext.crawlerSourceContext?.items,
  }), /Micron|美光|DRAM|NAND/);
}

await testContextContainsAcceptedSourcesOnly();
console.log('context multi-source filter tests passed');
