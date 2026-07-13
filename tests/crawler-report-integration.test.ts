import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

function remoteFsStub() {
  const writes: Array<{ path: string; content: string }> = [];
  const files: Record<string, string> = {};
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

function makeJob(context: Record<string, unknown>) {
  return {
    jobId: 'job-controlled-fetch',
    skill: 'write-hb',
    payload: {
      topic: '麦格昆磁近期在生产工艺、中试和量产方面的主要动向',
      report_type: 'K报',
      known_context: JSON.stringify(context),
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

function createService(options: {
  fetchedBody?: string;
  allowCrawlerFetch?: boolean;
}) {
  const remoteFs = remoteFsStub();
  const fetchCalls: Array<{ urls: string[]; options: Record<string, unknown> }> = [];
  const crawler = {
    fetchPublicUrls: async (urls: string[], fetchOptions: Record<string, unknown>) => {
      fetchCalls.push({ urls, options: fetchOptions });
      return {
        items: [{
          requestedUrl: urls[0],
          url: urls[0],
          title: '麦格昆磁量产工艺更新',
          publisher: 'Example Government',
          publishedAt: null,
          fetchedAt: '2026-07-06T00:00:00.000Z',
          contentText: options.fetchedBody || '麦格昆磁 Magnequench 公布生产工艺、中试和量产进展。'.repeat(8),
          contentSummary: '麦格昆磁生产工艺和量产进展。',
          retrievalMethod: 'controlled_fetch',
          metadata: { contentType: 'text/html', fetchedBy: 'crawler-core' },
        }],
        failures: [],
      };
    },
  };
  const webSupplement = {
    searchWithDiagnostics: async () => ({
      sources: [{
        title: '麦格昆磁量产工艺更新',
        url: 'https://example.gov/magnequench-update',
        summary: '麦格昆磁 Magnequench 发布生产工艺、中试和量产方面的新进展。',
        content: '',
        publisher: 'Example Government',
        publishedAt: '2026-07-05',
        sourceType: 'web',
        engine: 'tavily',
        query: '麦格昆磁 生产工艺 中试 量产',
        searchScore: 0.9,
      }],
      queryDiagnostics: [],
      durationMs: 5,
    }),
  };
  const service = new ReportsService(
    {} as never,
    remoteFs as never,
    {} as never,
    undefined,
    crawler as never,
    webSupplement as never,
  ) as ReportsService & {
    enrichPayloadWithWebSupplement: (
      job: ReturnType<typeof makeJob>,
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
  const context = {
    databaseSourceOptions: { enabled: true },
    vectorDatabaseSources: [],
    webSearchOptions: { enabled: true },
    sourceSupplementOptions: {
      minimumAcceptedDatabaseSources: 3,
      ...(options.allowCrawlerFetch === undefined ? {} : { allowCrawlerFetch: options.allowCrawlerFetch }),
    },
  };
  return { service, remoteFs, fetchCalls, job: makeJob(context) };
}

async function testControlledFetchMergesIntoWebSources() {
  const { service, remoteFs, fetchCalls, job } = createService({});
  const result = await service.enrichPayloadWithWebSupplement(job, job.payload as Record<string, unknown>);
  const context = JSON.parse(String(result.known_context));

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].urls, ['https://example.gov/magnequench-update']);
  assert.equal(context.webSources.length, 1);
  assert.equal(context.webSources[0].retrievalMethod, 'controlled_fetch');
  assert.equal(context.webSources[0].sourceType, 'web');
  assert.equal(context.webSources[0].validationStage, 'fetched_content_validation');
  assert.equal(context.crawlerSourceContext, undefined);
  assert.equal((job.artifacts as Record<string, unknown>).acceptedCrawlerSources, undefined);
  assert.ok(remoteFs.writes.every((write) => !write.path.includes('/crawler/')));
}

async function testExplicitFetchDisableIsHonored() {
  const { service, fetchCalls, job } = createService({ allowCrawlerFetch: false });
  const result = await service.enrichPayloadWithWebSupplement(job, job.payload as Record<string, unknown>);
  const context = JSON.parse(String(result.known_context));

  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(context.webSources, []);
}

async function testFetchedBodyMustPassEntityGuardAgain() {
  const unrelatedBody = '这是一篇只讨论其他公司和无关市场的长篇报道，没有目标公司的任何信息。'.repeat(12);
  const { service, job } = createService({ fetchedBody: unrelatedBody });
  const result = await service.enrichPayloadWithWebSupplement(job, job.payload as Record<string, unknown>);
  const context = JSON.parse(String(result.known_context));

  assert.deepEqual(context.webSources, []);
  assert.ok(Number(context.sourceDiagnostics?.supplement?.rejectedCount || 0) >= 1);
}

await testControlledFetchMergesIntoWebSources();
await testExplicitFetchDisableIsHonored();
await testFetchedBodyMustPassEntityGuardAgain();
console.log('crawler report integration tests passed');
