import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-sync-'));
const inboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-inbox-'));
process.env.ARTIFACT_LOCAL_ROOT = artifactRoot;
process.env.REPORT_OUTPUT_DIR = artifactRoot;
process.env.HERMES_LOCAL_OUTPUT_DIR = artifactRoot;
process.env.HERMES_REMOTE_OUTPUT_DIR = '/workspace/reports';
process.env.HERMES_REMOTE_CONTAINER_REPORT_DIR = '/workspace/reports';
process.env.HERMES_REMOTE_REPORT_ROOT = '/workspace/reports';
process.env.HERMES_SHARED_REPORT_ROOT = inboxRoot;

const { ArtifactPathResolver } = await import('../server/artifact-path-resolver.service.js');
const { ArtifactStorageFacade } = await import('../server/artifact-storage/artifact-storage.service.js');
const { ArtifactSyncService } = await import('../server/artifact-storage/artifact-sync.service.js');
const { LocalArtifactStorageService } = await import('../server/artifact-storage/local-artifact-storage.service.js');

const legacy = path.join(inboxRoot, 'NEO_Magnequench_HB_20260710.md');
fs.writeFileSync(legacy, '# Report\n\n' + '正文。'.repeat(300), 'utf8');
const sync = new ArtifactSyncService(
  new ArtifactStorageFacade(new LocalArtifactStorageService()),
  new ArtifactPathResolver(),
);

const result = await sync.syncReportMarkdown({
  jobId: 'job-1',
  reportPointer: '/workspace/reports/NEO_Magnequench_HB_20260710.md',
});
assert.equal(result.status, 'completed');
assert.equal(result.artifacts.reportMarkdown.storageKey, 'reports/job-1/final/report.md');
assert.equal(fs.existsSync(path.join(artifactRoot, 'reports/job-1/final/report.md')), true);
assert.equal(String(result.diagnostics.mode), 'shared_volume');
console.log('artifact sync shared volume tests passed');
