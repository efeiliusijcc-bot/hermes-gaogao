import assert from 'node:assert/strict';
import fs from 'node:fs';
const sidebarSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue', import.meta.url),
  'utf8',
);
const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);
assert.match(sidebarSource, /class="draft-history-layer draft-history-sidebar"/);
assert.match(sidebarSource, /:class="\{ open \}"/);
assert.match(sidebarSource, /:role="open \? 'dialog' : 'complementary'"/);
assert.match(sidebarSource, /@click="emit\('close'\)"/);
assert.match(sidebarSource, /v-model="search"/);
assert.match(sidebarSource, /@click="emit\('select-event', item\.eventId\)"/);
assert.match(sidebarSource, /@media \(max-width: 900px\)/);
assert.match(sidebarSource, /class="draft-history-account"/);
assert.match(sidebarSource, /aria-label="账号菜单"/);
assert.doesNotMatch(sidebarSource, /scrollTop\s*=|scrollTo\s*\(/);
assert.match(assistantSource, /aria-label="查看拟稿历史"/);
assert.match(assistantSource, /:open="historyOpen"/);

console.log('frontend history sidebar tests passed');
