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

console.log('report live tool search sources tests passed');
