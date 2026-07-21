import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '../server/auth-user.interface.js';
import { ReportsService } from '../server/reports.service.js';

const cutoff = '2026-07-21T01:42:40Z';

function remoteFsStub() {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    readFile: async () => '# report',
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function reportJob(jobId: string, createdAt: string, status = 'succeeded') {
  return {
    jobId,
    skill: 'write-hb',
    payload: { topic: jobId, report_type: 'K' },
    ownerUserId: 'admin-1',
    ownerUsername: 'admin',
    ownerRole: 'admin',
    status,
    artifacts: {},
    createdAt,
    updatedAt: createdAt,
    events: [],
    eventLog: [],
  };
}

function createService() {
  const service = new ReportsService(
    {} as never,
    remoteFsStub() as never,
    { search: async () => ({ status: 'disabled', sources: [] }) } as never,
  ) as ReportsService & { jobs: Map<string, ReturnType<typeof reportJob>> };
  service.jobs.set('before', reportJob('before', '2026-07-21T01:42:39Z'));
  service.jobs.set('boundary', reportJob('boundary', cutoff, 'running'));
  service.jobs.set('after', reportJob('after', '2026-07-21T01:42:41Z'));
  return service;
}

const admin: AuthUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'admin',
  email: null,
  role: 'admin',
  roles: ['admin'],
  modules: ['report'],
  permissions: ['report:read'],
};

test('createdAfter filters before totals, status counts, and pagination', async () => {
  const result = await createService().listJobs({ createdAfter: cutoff, pageSize: 1 } as never, admin);

  assert.deepEqual(result.items.map((item) => item.jobId), ['after']);
  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.statusCounts, { succeeded: 1, running: 0 });
});

test('missing or invalid createdAfter keeps authorized history visible', async () => {
  const service = createService();
  const unfiltered = await service.listJobs({}, admin);
  const invalid = await service.listJobs({ createdAfter: 'not-a-date' } as never, admin);

  assert.equal(unfiltered.total, 3);
  assert.equal(invalid.total, 3);
});
