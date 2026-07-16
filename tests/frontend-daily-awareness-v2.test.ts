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

test('daily awareness management page exposes operations without scheduling controls', async () => {
  const adminSource = await source('components/DailyAwarenessAdmin.vue').catch(() => '');

  assert.match(adminSource, /运行状态/);
  assert.match(adminSource, /版本化配置/);
  assert.match(adminSource, /手动补生成/);
  assert.match(adminSource, /运行记录/);
  assert.match(adminSource, /死信/);
  assert.match(adminSource, /confirmOverwrite/);
  assert.doesNotMatch(adminSource, /每日生成时间|定时任务开关/);
});

test('daily awareness management API and system entry use exact manage permission', async () => {
  const [apiSource, appSource, managementSource, headerSource] = await Promise.all([
    source('lib/api.js'),
    source('App.vue'),
    source('components/UserManagement.vue'),
    source('components/NexusHeader.vue'),
  ]);

  assert.match(apiSource, /admin\/daily-awareness\/status/);
  assert.match(apiSource, /admin\/daily-awareness\/config/);
  assert.match(apiSource, /admin\/daily-awareness\/runs/);
  assert.match(apiSource, /admin\/daily-awareness\/inbox/);
  assert.match(apiSource, /admin\/daily-awareness\/regenerate/);
  assert.match(appSource, /system:daily-awareness:manage/);
  assert.match(managementSource, /system:daily-awareness:manage/);
  assert.match(managementSource, /DailyAwarenessAdmin/);
  assert.match(headerSource, /system:daily-awareness:manage/);
});
