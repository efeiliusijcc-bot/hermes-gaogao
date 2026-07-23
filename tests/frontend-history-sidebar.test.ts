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
assert.match(sidebarSource, /<Teleport to="body">/);
assert.match(sidebarSource, /v-if="open"/);
assert.match(sidebarSource, /role="dialog" aria-modal="true"/);
assert.match(sidebarSource, /@click="emit\('close'\)"/);
assert.match(sidebarSource, /v-model="search"/);
assert.match(sidebarSource, /@click="emit\('select-event', item\.eventId\)"/);
assert.match(sidebarSource, /@media \(max-width: 640px\)/);
assert.doesNotMatch(sidebarSource, /scrollTop\s*=|scrollTo\s*\(/);
assert.match(assistantSource, /aria-label="查看历史编报"/);
assert.match(assistantSource, /:open="historyOpen"/);

console.log('frontend history sidebar tests passed');
