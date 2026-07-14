import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url),
  'utf8',
);

assert.match(component, /const SOURCE_AUTO_REFRESH_MS = 5000/);
assert.match(component, /function startSourceAutoRefresh\(/);
assert.match(component, /function stopSourceAutoRefresh\(/);
assert.match(component, /function sourceChannelLabel\(/);
assert.match(component, /数据库召回/);
assert.match(component, /联网搜索采集/);
assert.match(component, /preserveOnError/);

console.log('frontend live source refresh tests passed');
