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

test('K-report history surfaces share the flag while unrelated histories remain available', async () => {
  const [appSource, controlSource, canvasSource, jobsSource, dailySource] = await Promise.all([
    frontendSource('src/App.vue'),
    frontendSource('src/components/ControlPanel.vue'),
    frontendSource('src/components/DataCanvas.vue'),
    frontendSource('src/composables/useReportJobs.js'),
    frontendSource('src/components/DailyAwareness.vue'),
  ]);

  assert.match(appSource, /import \{ REPORT_HISTORY_VISIBLE \} from '.\/lib\/reportHistoryVisibility\.js'/);
  assert.match(appSource, /const reportHistoryVisible = REPORT_HISTORY_VISIBLE/);
  assert.equal((appSource.match(/:report-history-visible="reportHistoryVisible"/g) || []).length, 2);
  assert.match(appSource, /currentView === 'generator' \|\| !reportHistoryVisible/);
  assert.match(appSource, /if \(!reportHistoryVisible\) return/);

  assert.match(controlSource, /reportHistoryVisible:\s*Boolean/);
  assert.match(controlSource, /v-if="isQaMode \|\| reportHistoryVisible"/);
  assert.match(controlSource, /问答历史/);

  assert.match(canvasSource, /reportHistoryVisible:\s*Boolean/);
  assert.equal(
    (canvasSource.match(/<button[^>]*v-if="reportHistoryVisible"[^>]*@click="emit\('list'\)"[^>]*>/g) || []).length,
    3,
  );

  assert.match(jobsSource, /fetchReportJobs/);
  assert.match(jobsSource, /createReportJob/);
  assert.match(dailySource, /历史简报/);
});
