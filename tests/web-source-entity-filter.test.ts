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
      if (!(path in files)) throw new Error(`missing file ${path}`);
      return files[path];
    },
    exists: async (path: string) => path in files,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function makeJob(context: Record<string, unknown>) {
  return {
    jobId: 'job-web-entity-filter',
    skill: 'write-hb',
    payload: { topic: context.topic, known_context: JSON.stringify(context) },
    ownerUserId: 'user-1',
    ownerUsername: 'operator',
    status: 'running',
    artifacts: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    eventLog: [],
  };
}

async function runWithSources(sources: Record<string, unknown>[]) {
  const remoteFs = remoteFsStub();
  const webSupplement = { search: async () => sources };
  const service = new ReportsService(
    {} as never,
    remoteFs as never,
    {} as never,
    undefined,
    undefined,
    webSupplement as never,
  ) as unknown as {
    enrichPayloadWithWebSupplement(job: Record<string, unknown>, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  const topic = 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向';
  const context = {
    topic,
    databaseSourceOptions: { enabled: true },
    webSearchOptions: { enabled: true },
    entityPolicy: buildRuleBasedEntityPolicy({ topic }),
    vectorDatabaseSources: [],
    sourceDiagnostics: { database: { acceptedCount: 0 } },
  };
  const job = makeJob(context);
  const result = await service.enrichPayloadWithWebSupplement(job, job.payload as Record<string, unknown>);
  return { context: JSON.parse(String(result.known_context)), remoteFs };
}

async function testCorrectEntityAcceptedAndConfusionRejected() {
  const correctContent = 'Magnequench and Neo Performance Materials official update describes production process improvements, pilot line validation, intermediate-scale trials and mass production readiness. '.repeat(3);
  const micronContent = 'Micron Technology discusses DRAM, NAND, memory pricing and its next earnings release. '.repeat(4);
  const { context, remoteFs } = await runWithSources([
    {
      title: 'Magnequench pilot and mass production process update',
      url: 'https://neo-performance-materials.com/official/magnequench-update',
      summary: '麦格昆磁披露生产工艺、中试和量产进展。',
      content: correctContent,
      publisher: 'Neo Performance Materials official',
      publishedAt: '2026-07-01',
      sourceType: 'web',
      engine: 'tavily',
      query: 'Magnequench production process',
      searchScore: 0.9,
    },
    {
      title: 'Micron earnings and DRAM outlook',
      url: 'https://example.com/micron',
      summary: '美光 Micron Technology DRAM NAND 财报。',
      content: micronContent,
      publisher: 'Market Blog',
      publishedAt: '2026-07-01',
      sourceType: 'web',
      engine: 'tavily',
      query: 'Magnequench production process',
      searchScore: 0.99,
    },
  ]);
  assert.equal(context.webSources.length, 1);
  assert.match(context.webSources[0].title, /Magnequench/);
  assert.doesNotMatch(JSON.stringify(context.webSources), /Micron/);
  const diagnostics = remoteFs.writes.find((item) => item.path.endsWith('/web_supplement_diagnostics.json'));
  assert.ok(diagnostics);
  assert.match(diagnostics.content, /Micron/);
}

async function testSearchSummaryPassesButFetchedBodyFails() {
  const unrelatedBody = 'Micron Technology focuses on DRAM and NAND memory pricing, quarterly earnings and stock-market expectations. '.repeat(4);
  const { context, remoteFs } = await runWithSources([{
    title: 'Magnequench production process update',
    url: 'https://example.com/mismatched-body',
    summary: '麦格昆磁生产工艺、中试和量产进展。',
    content: unrelatedBody,
    publisher: 'Industry News',
    publishedAt: '2026-07-01',
    sourceType: 'web',
    engine: 'tavily',
    query: 'Magnequench production process',
    searchScore: 0.9,
  }]);
  assert.equal(context.webSources.length, 0);
  const diagnostics = remoteFs.writes.find((item) => item.path.endsWith('/web_supplement_diagnostics.json'));
  assert.match(diagnostics?.content || '', /标题与正文不一致/);
}

await testCorrectEntityAcceptedAndConfusionRejected();
await testSearchSummaryPassesButFetchedBodyFails();
console.log('web source entity filter tests passed');
