import assert from 'node:assert/strict';

process.env.HERMES_SHARED_REPORT_ROOT = '/app/hermes-inbox';
const { ReportsService } = await import('../server/reports.service.js');

const jobId = 'job-1';
const sharedResearchEntries = ['research_A.json'];
let extraResearchReads = 0;
const files: Record<string, string> = {
  '/app/storage/artifacts/job-1/research/consolidated.json': JSON.stringify({
    sources: [{
      title: 'Accepted supplement',
      url: 'https://example.com/accepted?utm_source=artifact',
      engine: 'tavily',
      sourceQuality: { status: 'accepted', score: 0.9 },
    }],
  }),
  '/app/hermes-inbox/job-1/research/research_A.json': JSON.stringify({
    sources: [
      { title: 'High source', url: 'https://example.com/high?utm_source=one', engine: 'tavily', credibility_score: 0.95, credibility_tier: 'high' },
      { title: 'Duplicate high source', url: 'https://example.com/high?utm_medium=two', engine: 'tavily', credibility_score: 0.8, credibility_tier: 'medium-high' },
      { title: 'Low source', url: 'https://example.com/low', engine: 'tavily', credibility_score: 0.5 },
    ],
    evidence_cards: [
      { title: 'Evidence source', url: 'https://example.com/evidence', engine: 'web_fetch' },
    ],
  }),
};

const remoteFs = {
  remoteDir: '/app/storage/artifacts',
  joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/, '/'),
  readFile: async (filePath: string) => {
    if (filePath.includes('/research_extra_')) extraResearchReads += 1;
    if (!(filePath in files)) throw new Error(`missing file: ${filePath}`);
    return files[filePath];
  },
  exists: async (filePath: string) => filePath in files,
  readdir: async (dir: string) => {
    if (dir === '/app/storage/artifacts/job-1/research') return [{ name: 'consolidated.json', isFile: true }];
    if (dir === '/app/hermes-inbox/job-1/research') return sharedResearchEntries.map((name) => ({ name, isFile: true }));
    return [];
  },
};

const service = Object.create(ReportsService.prototype) as ReportsService & {
  remoteFs: typeof remoteFs;
  resolveHermesJobDir: () => Promise<null>;
  toolSearchSources: (job: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};
service.remoteFs = remoteFs;
service.resolveHermesJobDir = async () => null;

const sources = await service.toolSearchSources({ jobId, payload: {} });

assert.deepEqual(sources.map((item) => item.url).sort(), [
  'https://example.com/accepted?utm_source=artifact',
  'https://example.com/evidence',
  'https://example.com/high?utm_source=one',
].sort());
assert.ok(sources.every((item) => item.sourceGroup === 'tool_search'));
assert.ok(!sources.some((item) => String(item.url).includes('/low')));

service.resolveHermesJobDir = async () => {
  throw new Error('artifact directory scan failed');
};

const sourcesWhenResolverFails = await service.toolSearchSources({ jobId, payload: {} });

assert.deepEqual(sourcesWhenResolverFails.map((item) => item.url).sort(), [
  'https://example.com/accepted?utm_source=artifact',
  'https://example.com/evidence',
  'https://example.com/high?utm_source=one',
].sort());

service.resolveHermesJobDir = async () => null;
sharedResearchEntries.push('research_eligible.json');
files['/app/hermes-inbox/job-1/research/research_eligible.json'] = JSON.stringify({
  sources: Array.from({ length: 301 }, (_, index) => ({
    title: `Low-value candidate ${index}`,
    url: `https://example.com/low-candidate-${index}`,
    engine: 'tavily',
    credibility_score: 0.1,
  })),
  evidence_cards: [
    { title: 'Late evidence source', url: 'https://example.com/late-evidence', engine: 'web_fetch' },
  ],
});

const eligibleSources = await service.toolSearchSources({ jobId, payload: {} });

assert.ok(
  eligibleSources.some((item) => item.url === 'https://example.com/late-evidence'),
  'expected evidence after low-value candidates to survive eligible bounds',
);

for (let index = 0; index < 75; index += 1) {
  const name = `research_extra_${index}.json`;
  sharedResearchEntries.push(name);
  files[`/app/hermes-inbox/job-1/research/${name}`] = JSON.stringify({
    sources: [{
      title: `Extra source ${index}`,
      url: `https://example.com/extra-${index}`,
      engine: 'tavily',
      credibility_score: 0.95,
      credibility_tier: 'high',
    }],
  });
}

const boundedSources = await service.toolSearchSources({ jobId, payload: {} });

assert.equal(boundedSources.length, 50);
assert.ok(extraResearchReads <= 50, `expected a bounded research scan, read ${extraResearchReads} extra files`);

const databaseSource = {
  id: 'database-1',
  sourceGroup: 'structured_sources' as const,
  sourceOrigin: 'database_recall' as const,
  evidenceKind: 'structured_source' as const,
  engine: 'database' as const,
  title: 'Database source',
  url: 'https://example.com/database',
  sourceName: 'Database',
  publishTime: '',
  summary: '',
  excerpt: '',
  sourceType: '数据库记录',
  relevanceScore: 0.9,
  status: 'accepted',
  method: 'database',
};

const endpointService = Object.create(ReportsService.prototype) as ReportsService & Record<string, unknown>;
endpointService.assertCanAccessJob = () => ({ jobId, payload: {} });
endpointService.normalizeReportSourceType = () => 'all';
endpointService.parsePositiveInt = (value: unknown, fallback: number) => Number(value) || fallback;
endpointService.structuredReportSources = async () => [databaseSource];
endpointService.crawlerReportSources = async () => [];
endpointService.toolSearchSources = async () => [];
endpointService.candidateHitSources = async () => ({ items: [], total: 0, detailSaved: false });
endpointService.extractFailedSources = async () => [];
endpointService.resolveHermesJobDir = async () => {
  throw new Error('legacy job directory lookup failed');
};
endpointService.reportReferenceSources = async (job: Record<string, unknown>) => {
  await (endpointService.resolveHermesJobDir as (value: Record<string, unknown>) => Promise<null>)(job);
  return [];
};
endpointService.reportSourceDiagnostics = async (job: Record<string, unknown>) => {
  await (endpointService.resolveHermesJobDir as (value: Record<string, unknown>) => Promise<null>)(job);
  return {};
};

const databaseResponse = await endpointService.getSources(jobId, {}, {} as never);

assert.deepEqual(databaseResponse?.items.map((item) => item.url), ['https://example.com/database']);
assert.equal(databaseResponse?.meta?.summary && (databaseResponse.meta.summary as { databaseRecallCount: number }).databaseRecallCount, 1);

const eligibleResearchSources = Array.from({ length: 55 }, (_, index) => ({
  id: `high-value-${index}`,
  sourceGroup: 'tool_search' as const,
  sourceOrigin: 'tool_search' as const,
  evidenceKind: 'research_source' as const,
  engine: 'tavily' as const,
  title: `High-value source ${index}`,
  url: `https://example.com/high-value-${index}`,
  sourceName: 'Example',
  publishTime: '',
  summary: '',
  excerpt: '',
  sourceType: '互联网搜索',
  relevanceScore: 0.9,
  status: 'accepted',
  method: 'research',
}));
const eligibleMatchedReference = {
  ...eligibleResearchSources[0],
  id: 'report-ref-eligible',
  sourceGroup: 'report_refs' as const,
  evidenceKind: 'report_reference' as const,
  title: 'Matched eligible report reference',
  citationNo: 1,
  matchStatus: 'matched' as const,
};
const ineligibleMatchedReference = {
  ...eligibleMatchedReference,
  id: 'report-ref-ineligible',
  title: 'Matched but unverified report reference',
  url: 'https://example.com/unverified-report-reference',
  citationNo: 2,
};

const finalToolSearch = service.toolSearchChannelSources(
  eligibleResearchSources,
  [eligibleMatchedReference, ineligibleMatchedReference],
  [],
);

assert.equal(finalToolSearch.length, 50);
assert.ok(finalToolSearch.every((item) => item.url !== 'https://example.com/unverified-report-reference'));
assert.equal(finalToolSearch.find((item) => item.url === 'https://example.com/high-value-0')?.citationNo, 1);

console.log('report live tool search sources tests passed');
