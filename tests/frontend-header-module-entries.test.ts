import assert from 'node:assert/strict';
import fs from 'node:fs';

const headerSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/NexusHeader.vue', import.meta.url),
  'utf8',
);
const stylesSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/styles/main.css', import.meta.url),
  'utf8',
);

assert.match(headerSource, /class="header-module-nav"/);
assert.match(headerSource, /v-for="item in visibleWorkspaceItems"/);
assert.match(headerSource, /class="header-module-entry"/);
assert.match(headerSource, /@click="emit\('switch-workspace', item\.key\)"/);
assert.doesNotMatch(headerSource, /workspace-quick-trigger|toggleWorkspaceNav|workspaceNavOpen/);
assert.match(stylesSource, /\.header-module-nav\s*\{[\s\S]*display:\s*flex/);
assert.match(stylesSource, /@media \(max-width:\s*768px\)[\s\S]*\.header-module-nav\s*\{[\s\S]*overflow-x:\s*auto/);

console.log('frontend header module entry tests passed');
