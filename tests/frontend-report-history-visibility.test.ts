import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isReportHistoryVisible } from '../b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js';

const frontendRoot = new URL('../b_k3ewYvsOEc1/', import.meta.url);

async function frontendSource(relativePath: string) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('report history is hidden unless the build flag is exactly true', () => {
  assert.equal(isReportHistoryVisible(undefined), false);
  assert.equal(isReportHistoryVisible({}), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'false' }), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'TRUE' }), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'true' }), true);
});

test('production frontend explicitly hides report history by default', async () => {
  const envSource = await frontendSource('.env.production');
  assert.match(envSource, /^VITE_REPORT_HISTORY_VISIBLE=false$/m);
});
