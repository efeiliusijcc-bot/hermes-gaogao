import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const jobId = '53385afa-9f59-4c19-8320-be1d956b9cc4';
const root = '/app/storage/artifacts';
const files: Record<string, string> = {
  [`${root}/${jobId}/context.json`]: JSON.stringify({
    webSources: [{
      title: 'Neo Performance Materials official update',
      url: 'https://www.neomaterials.com/news/official-update',
      publisher: 'Neo Performance Materials',
      summary: 'Magnequench production update',
      sourceType: 'web',
      engine: 'tavily',
      sourceQuality: 95,
      entityMatch: { status: 'accepted' },
    }],
  }),
};

const remoteFs = {
  remoteDir: root,
  joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
  readFile: async (filePath: string) => {
    if (!(filePath in files)) throw new Error(`missing file: ${filePath}`);
    return files[filePath];
  },
  // RemoteFileService.exists currently reports files only, not directories.
  exists: async (filePath: string) => filePath in files,
  readdir: async () => [],
};

const service = Object.create(ReportsService.prototype) as ReportsService & {
  remoteFs: typeof remoteFs;
  toolSearchSources: (job: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};
service.remoteFs = remoteFs;

const sources = await service.toolSearchSources({
  jobId,
  payload: { topic: 'Magnequench production update' },
});

assert.equal(sources.length, 1);
assert.equal(sources[0].url, 'https://www.neomaterials.com/news/official-update');
assert.equal(sources[0].sourceOrigin, 'tool_search');

console.log('report source artifact persistence tests passed');
