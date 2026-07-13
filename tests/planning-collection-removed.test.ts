import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

async function source(path: string) {
  return readFile(join(root, path), 'utf8');
}

async function testPlanningCollectionUiIsRemoved() {
  const [canvas, app, jobs] = await Promise.all([
    source('b_k3ewYvsOEc1/src/components/DataCanvas.vue'),
    source('b_k3ewYvsOEc1/src/App.vue'),
    source('b_k3ewYvsOEc1/src/composables/useReportJobs.js'),
  ]);

  for (const legacySymbol of [
    'crawler-plan-section',
    'planningCrawlerStatus',
    'planningCrawlerItems',
    'selectedCrawlerItemIds',
    'runPlanningCrawler',
    'crawlerPlan',
    '规划采集会话',
    '启用资料采集',
    '资料采集工具',
  ]) {
    assert.doesNotMatch(`${canvas}\n${app}\n${jobs}`, new RegExp(legacySymbol), `legacy UI symbol remains: ${legacySymbol}`);
  }

  assert.match(canvas, /人工指定信源（可选）/);
  assert.doesNotMatch(canvas, /兼容补充信源|采集结果以实际命中为准/);
}

async function testCrawlerHttpApiIsRemoved() {
  const [api, appModule] = await Promise.all([
    source('b_k3ewYvsOEc1/src/lib/api.js'),
    source('server/app.module.ts'),
  ]);

  assert.doesNotMatch(api, /createCrawlerTask|runCrawlerTask|getCrawlerTaskItems|\/crawler\//);
  assert.doesNotMatch(appModule, /CrawlerController|InternalCrawlerController|crawler\.controller/);

  await assert.rejects(
    access(join(root, 'server/crawler.controller.ts'), constants.F_OK),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
}

async function testReportModuleNoLongerGrantsCrawlerPermissions() {
  const [backendModules, frontendModules, e2eSetup] = await Promise.all([
    source('server/permission-modules.ts'),
    source('b_k3ewYvsOEc1/src/lib/permissionModules.js'),
    source('scripts/setup-live-report-e2e-users.ts'),
  ]);

  const reportBackendBlock = backendModules.match(/key: 'report',[\s\S]*?corePermissions:/)?.[0] || '';
  const reportFrontendBlock = frontendModules.match(/report: \[[\s\S]*?\],/)?.[0] || '';
  for (const permission of ['crawler:create', 'crawler:read', 'crawler:execute']) {
    assert.doesNotMatch(reportBackendBlock, new RegExp(permission));
    assert.doesNotMatch(reportFrontendBlock, new RegExp(permission));
    assert.doesNotMatch(e2eSetup, new RegExp(permission));
  }
}

await testPlanningCollectionUiIsRemoved();
await testCrawlerHttpApiIsRemoved();
await testReportModuleNoLongerGrantsCrawlerPermissions();
console.log('planning collection removal tests passed');
