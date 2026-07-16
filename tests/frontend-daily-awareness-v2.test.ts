import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontendRoot = new URL('../b_k3ewYvsOEc1/src/', import.meta.url);

async function source(relativePath: string) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('daily awareness user page is a read-only current brief workspace', async () => {
  const dailySource = await source('components/DailyAwareness.vue');

  assert.match(dailySource, /今日业务日期/);
  assert.match(dailySource, /当前展示/);
  assert.match(dailySource, /简要版/);
  assert.doesNotMatch(dailySource, /最大条数|回溯小时|生成每日简报|重新生成/);
});

test('daily awareness frontend uses V2 current and exact-date APIs', async () => {
  const apiSource = await source('lib/api.js');

  assert.match(apiSource, /daily-awareness\/current/);
  assert.match(apiSource, /daily-awareness\/history/);
  assert.match(apiSource, /briefs\/by-date/);
});

test('daily awareness module and application entry require exact view permission', async () => {
  const [appSource, permissionSource] = await Promise.all([
    source('App.vue'),
    source('lib/permissionModules.js'),
  ]);

  assert.match(appSource, /daily-awareness:view/);
  assert.match(permissionSource, /daily:\s*\['daily-awareness:view'\]/);
});
