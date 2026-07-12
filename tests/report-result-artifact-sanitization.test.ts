import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';

const user = {
  id: 'user-1',
  username: 'operator',
  displayName: 'Operator',
  email: null,
  role: 'operator',
  roles: ['operator'],
  permissions: ['report:read'],
} as AuthUser;

const service = Object.create(ReportsService.prototype) as ReportsService & {
  jobs: Map<string, unknown>;
};

service.jobs = new Map([
  ['job-1', {
    jobId: 'job-1',
    ownerUserId: 'user-1',
    ownerUsername: 'operator',
    status: 'succeeded',
    markdown: '# Report',
    artifacts: {
      hermesJobDir: '/app/storage/artifacts/job-1',
      databaseSourcesPath: '/app/storage/artifacts/job-1/database/database_sources.json',
      reportMarkdown: {
        storageProvider: 'local',
        storageKey: 'reports/job-1/final/report.md',
        fileName: 'report.md',
        artifactType: 'report_markdown',
        mimeType: 'text/markdown; charset=utf-8',
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
        createdAt: '2026-07-11T00:00:00.000Z',
      },
    },
  }],
]);

const result = await service.getResult('job-1', user);
assert.ok(result);
assert.deepEqual(Object.keys(result.artifacts), ['reportMarkdown']);
assert.equal(result.artifacts.reportMarkdown.storageKey, 'reports/job-1/final/report.md');
assert.equal(JSON.stringify(result).includes('/app/storage/artifacts'), false);
assert.equal(JSON.stringify(result).includes('/opt/data'), false);
assert.equal(JSON.stringify(result).includes('/app/hermes-inbox'), false);

console.log('report result artifact sanitization tests passed');
