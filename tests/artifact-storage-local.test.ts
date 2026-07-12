import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-local-artifacts-'));
process.env.ARTIFACT_LOCAL_ROOT = root;

const { LocalArtifactStorageService } = await import('../server/artifact-storage/local-artifact-storage.service.js');

const storage = new LocalArtifactStorageService();
const stored = await storage.put({
  jobId: 'job-1',
  artifactType: 'report_markdown',
  storageKey: 'reports/job-1/final/report.md',
  fileName: 'report.md',
  mimeType: 'text/markdown; charset=utf-8',
  content: '# Report\n\nhello',
});

assert.equal(stored.storageProvider, 'local');
assert.equal(stored.storageKey, 'reports/job-1/final/report.md');
assert.equal(stored.sizeBytes, Buffer.byteLength('# Report\n\nhello'));
assert.match(stored.sha256, /^[a-f0-9]{64}$/);
assert.equal(await storage.exists(stored.storageKey), true);
assert.deepEqual(await storage.getMetadata(stored.storageKey), stored);
const chunks: Buffer[] = [];
for await (const chunk of await storage.createReadStream(stored.storageKey)) chunks.push(Buffer.from(chunk));
assert.equal(Buffer.concat(chunks).toString('utf8'), '# Report\n\nhello');
await assert.rejects(() => storage.exists('../escape.md'), /Invalid artifact storage key/);
console.log('artifact storage local tests passed');
