import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ReportsService } from '../server/reports.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

function remoteFsStub() {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => { writes.push({ path, content }); },
    readFile: async () => { throw new Error('missing'); },
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

const reportUser: AuthUser = {
  id: 'user-1', username: 'operator-1', displayName: '', email: null, role: 'operator', roles: ['operator'],
  modules: ['report'], permissions: ['report:create', 'report:read'],
};

async function testReportCreationHasNoLegacyCollectionSideEffects() {
  const remoteFs = remoteFsStub();
  const crawler = new Proxy({}, {
    get: (_target, property) => {
      if (property === 'fetchPublicUrls') return async () => ({ items: [], failures: [] });
      throw new Error(`unexpected crawler access: ${String(property)}`);
    },
  });
  const service = new ReportsService({} as never, remoteFs as never, {} as never, undefined, crawler as never) as ReportsService & {
    jobs: Map<string, Record<string, unknown>>;
  };
  const previousSetImmediate = globalThis.setImmediate;
  globalThis.setImmediate = (() => ({}) as NodeJS.Immediate) as typeof setImmediate;
  try {
    const created = await service.createJob({
      skill: 'write-hb',
      payload: {
        topic: '不依赖规划采集的正式任务',
        known_context: JSON.stringify({
          userProvidedSources: ['https://example.com/manual'],
          crawlerPlan: { enabled: true },
          selectedCrawlerItemIds: ['legacy-item'],
        }),
      },
    }, reportUser);
    const stored = service.jobs.get(created.jobId)!;
    const payload = stored.payload as Record<string, unknown>;
    const context = JSON.parse(String(payload.known_context));
    assert.deepEqual(context.userProvidedSources, ['https://example.com/manual']);
    assert.equal(context.crawlerPlan, undefined);
    assert.equal(context.selectedCrawlerItemIds, undefined);
    assert.ok(remoteFs.writes.every((write) => !/crawler|planning.collection/i.test(`${write.path}\n${write.content}`)));
  } finally {
    globalThis.setImmediate = previousSetImmediate;
  }
}

async function testReportsServiceHasNoLegacyTaskOrArtifactCode() {
  const source = await readFile(new URL('../server/reports.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /crawler_tasks|crawler_items/);
  assert.doesNotMatch(source, /\.createTask\(|\.runTask\(/);
  assert.doesNotMatch(source, /crawler\/crawler_sources\.json|crawler_sources\.json/);
}

await testReportCreationHasNoLegacyCollectionSideEffects();
await testReportsServiceHasNoLegacyTaskOrArtifactCode();
console.log('report creation without planning collection tests passed');
