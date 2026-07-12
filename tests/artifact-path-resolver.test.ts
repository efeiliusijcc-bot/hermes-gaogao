import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-outside-'));
process.env.REPORT_OUTPUT_DIR = root;
process.env.HERMES_LOCAL_OUTPUT_DIR = root;
process.env.HERMES_REMOTE_OUTPUT_DIR = '/workspace/reports';
process.env.HERMES_REMOTE_CONTAINER_REPORT_DIR = '/workspace/reports';

const { ArtifactPathResolver } = await import('../server/artifact-path-resolver.service.js');

function write(filePath: string, content = '# Report\n\nValid report body with enough text.\n'.repeat(80)) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function testRelativePath() {
  const resolver = new ArtifactPathResolver();
  const filePath = path.join(root, 'job-1', 'final', 'report.md');
  write(filePath);
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', relativePath: 'job-1/final/report.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'local');
  assert.equal(result.exists, true);
  assert.equal(result.localPath, fs.realpathSync(filePath));
}

async function testRemotePrefixMapping() {
  const resolver = new ArtifactPathResolver();
  const filePath = path.join(root, 'job-1', 'report.md');
  write(filePath);
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', remotePath: '/workspace/reports/job-1/report.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.exists, true);
  assert.equal(result.localPath, fs.realpathSync(filePath));
}

async function testMissingWhenUnmapped() {
  const resolver = new ArtifactPathResolver();
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', remotePath: '/other/reports/job-1/report.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'missing');
  assert.equal(result.exists, false);
}

async function testPathTraversalRejected() {
  const resolver = new ArtifactPathResolver();
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', relativePath: '../../etc/passwd', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'rejected');
}

async function testWrongJobRejected() {
  const resolver = new ArtifactPathResolver();
  const filePath = path.join(root, 'job-2', 'report.md');
  write(filePath);
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', remotePath: '/workspace/reports/job-2/report.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'rejected');
}

async function testLegacyRootMarkdownStagedIntoJobDir() {
  const resolver = new ArtifactPathResolver();
  const filePath = path.join(root, 'legacy-report.md');
  write(filePath);
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', remotePath: '/workspace/reports/legacy-report.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.exists, true);
  assert.equal(result.localPath, fs.realpathSync(path.join(root, 'job-1', 'final', 'report.md')));
}

async function testSymlinkEscapeRejected() {
  const resolver = new ArtifactPathResolver();
  const outsideFile = path.join(outside, 'job-1-report.md');
  write(outsideFile);
  const linkPath = path.join(root, 'job-1', 'linked.md');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try { fs.symlinkSync(outsideFile, linkPath); } catch { return; }
  const result = await resolver.resolveHermesArtifactPath({ jobId: 'job-1', remotePath: '/workspace/reports/job-1/linked.md', artifactType: 'reportMarkdown' });
  assert.equal(result.status, 'rejected');
}

await testRelativePath();
await testRemotePrefixMapping();
await testMissingWhenUnmapped();
await testPathTraversalRejected();
await testWrongJobRejected();
await testLegacyRootMarkdownStagedIntoJobDir();
await testSymlinkEscapeRejected();
console.log('artifact path resolver tests passed');
