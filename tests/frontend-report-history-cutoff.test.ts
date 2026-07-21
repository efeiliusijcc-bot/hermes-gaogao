import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontendRoot = new URL('../b_k3ewYvsOEc1/', import.meta.url);

async function frontendSource(relativePath: string) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('production config uses a temporary report-history cutoff', async () => {
  const envSource = await frontendSource('.env.production');

  assert.match(envSource, /^VITE_REPORT_HISTORY_CREATED_AFTER=2026-07-21T01:42:40Z$/m);
  assert.doesNotMatch(envSource, /VITE_REPORT_HISTORY_VISIBLE/);
});

test('recent and complete report-history requests use the same cutoff', async () => {
  const jobsSource = await frontendSource('src/composables/useReportJobs.js');

  assert.match(jobsSource, /import \{ REPORT_HISTORY_CREATED_AFTER \} from '\.\.\/lib\/reportHistoryCutoff\.js'/);
  assert.equal(
    (jobsSource.match(/createdAfter:\s*REPORT_HISTORY_CREATED_AFTER/g) || []).length,
    2,
  );
});

test('K-report history UI remains available while records are filtered', async () => {
  const [appSource, controlSource, canvasSource, dailySource] = await Promise.all([
    frontendSource('src/App.vue'),
    frontendSource('src/components/ControlPanel.vue'),
    frontendSource('src/components/DataCanvas.vue'),
    frontendSource('src/components/DailyAwareness.vue'),
  ]);

  assert.doesNotMatch(appSource, /reportHistoryVisible|REPORT_HISTORY_VISIBLE|report-history-visible/);
  assert.match(appSource, /v-else-if="currentView === 'generator'"/);
  assert.doesNotMatch(appSource, /if \(!reportHistoryVisible\) return/);

  assert.doesNotMatch(controlSource, /reportHistoryVisible/);
  assert.match(controlSource, /<section class="panel recent-card/);
  assert.match(controlSource, /编报历史/);
  assert.match(controlSource, /查看全部报告/);

  assert.doesNotMatch(canvasSource, /reportHistoryVisible/);
  assert.equal(
    (canvasSource.match(/<button[^>]*@click="emit\('list'\)"[^>]*>/g) || []).length,
    3,
  );

  assert.match(dailySource, /历史简报/);
});
