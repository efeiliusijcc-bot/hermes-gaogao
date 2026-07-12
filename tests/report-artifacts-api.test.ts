import assert from 'node:assert/strict';
import { ReportsController } from '../server/reports.controller.js';
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

const markdown = '# Report\n\nartifact body';
const artifact = {
  storageProvider: 'local',
  storageKey: 'reports/job-1/final/report.md',
  fileName: 'report.md',
  artifactType: 'report_markdown',
  mimeType: 'text/markdown; charset=utf-8',
  sizeBytes: Buffer.byteLength(markdown),
  sha256: 'a'.repeat(64),
  createdAt: '2026-07-11T00:00:00.000Z',
};

const service = {
  async getMarkdownFromDisk(jobId: string, authUser: AuthUser) {
    assert.equal(jobId, 'job-1');
    assert.equal(authUser.id, 'user-1');
    return {
      markdown,
      artifacts: { reportMarkdown: artifact },
      resultPath: artifact.storageKey,
      artifact,
    };
  },
  async getArtifacts(jobId: string, authUser: AuthUser) {
    assert.equal(jobId, 'job-1');
    assert.equal(authUser.id, 'user-1');
    return {
      jobId,
      status: 'succeeded',
      artifacts: { reportMarkdown: artifact },
      artifactSyncStatus: 'completed',
      artifactSyncDiagnostics: {},
      result: { storageKey: artifact.storageKey, ready: true },
    };
  },
};

const controller = new ReportsController(service as never);

const response = mockResponse();
const body = await controller.download('job-1', user, response as never);
assert.equal(body, markdown);
assert.equal(response.headers['Content-Type'], 'text/markdown; charset=utf-8');
assert.equal(response.headers['Content-Length'], String(Buffer.byteLength(markdown)));
assert.equal(response.headers['Content-Disposition'], 'attachment; filename="report.md"');
assert.equal(response.headers.ETag, `"sha256-${artifact.sha256}"`);
assert.equal(response.headers['X-Artifact-SHA256'], artifact.sha256);

const artifacts = await controller.artifacts('job-1', user);
assert.deepEqual(artifacts.artifacts, { reportMarkdown: artifact });
assert.equal(artifacts.result.storageKey, 'reports/job-1/final/report.md');

console.log('report artifact API tests passed');

function mockResponse() {
  return {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
}
