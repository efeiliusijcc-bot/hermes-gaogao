import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HISTORY_SIDEBAR_PREFERENCE_KEY,
  historySidebarColumns,
  readHistorySidebarPreference,
  resolveHistorySidebarCollapsed,
  shouldAutoCollapseHistory,
  writeHistorySidebarPreference,
} from '../b_k3ewYvsOEc1/src/lib/draftHistorySidebar.js';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();

// 1. Step 1 defaults to expanded.
assert.equal(resolveHistorySidebarCollapsed({ currentStep: 1, eventChanged: true }), false);

// 2. Step 4 auto-collapses.
assert.equal(resolveHistorySidebarCollapsed({ currentStep: 4, eventChanged: true }), true);

// 3. generating -> generated triggers collapse only after completion.
assert.equal(shouldAutoCollapseHistory({ currentStep: 3, draftStatus: 'generating' }), false);
assert.equal(shouldAutoCollapseHistory({ currentStep: 3, draftStatus: 'generated' }), true);
assert.equal(shouldAutoCollapseHistory({ currentStep: 3, draftStatus: 'completed' }), true);

// 4. A manual expanded preference wins over autosave and ordinary refreshes.
assert.equal(resolveHistorySidebarCollapsed({ preference: 'expanded', currentStep: 4, draftStatus: 'completed' }), false);
assert.equal(resolveHistorySidebarCollapsed({ preference: 'expanded', currentStep: 4, draftStatus: 'completed', currentCollapsed: true }), false);

// 5. Switching to a new Step 2 event expands in auto mode.
assert.equal(resolveHistorySidebarCollapsed({ currentStep: 2, currentCollapsed: true, eventChanged: true }), false);

// 6. Switching to a Step 4 event collapses in auto mode.
assert.equal(resolveHistorySidebarCollapsed({ currentStep: 4, currentCollapsed: false, eventChanged: true }), true);

// 7. localStorage expanded preference prevents automatic collapse.
writeHistorySidebarPreference(storage, 'expanded');
assert.equal(storage.getItem(HISTORY_SIDEBAR_PREFERENCE_KEY), 'expanded');
assert.equal(readHistorySidebarPreference(storage), 'expanded');
assert.equal(resolveHistorySidebarCollapsed({ preference: readHistorySidebarPreference(storage), currentStep: 5 }), false);

// 8. localStorage collapsed preference always collapses.
writeHistorySidebarPreference(storage, 'collapsed');
assert.equal(resolveHistorySidebarCollapsed({ preference: readHistorySidebarPreference(storage), currentStep: 1 }), true);

// 9. Collapsing releases 186px to the main editor when the right panel is visible.
assert.equal(historySidebarColumns(false, true), '250px minmax(720px, 1fr) 270px');
assert.equal(historySidebarColumns(true, true), '64px minmax(720px, 1fr) 270px');
assert.equal(250 - 64, 186);

const sidebarSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue', import.meta.url),
  'utf8',
);
const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);
const composableSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/composables/useCollapsibleHistorySidebar.js', import.meta.url),
  'utf8',
);

// 10. Collapsed mode hides full titles visually but keeps accessible labels/tooltips.
assert.match(sidebarSource, /v-if="collapsed"/);
assert.match(sidebarSource, /:title="`\$\{item\.title\}/);
assert.match(sidebarSource, /:aria-label="`\$\{item\.title\}/);

// 11. Toggle exposes aria-expanded and aria-controls.
assert.match(sidebarSource, /:aria-expanded="!collapsed"/);
assert.match(sidebarSource, /aria-controls="draft-history-sidebar-content"/);
assert.match(sidebarSource, /@keydown\.enter\.prevent="requestToggle"/);
assert.match(sidebarSource, /@keydown\.space\.prevent="requestToggle"/);

// 12. Reduced-motion disables both sidebar and grid transitions.
assert.match(sidebarSource, /prefers-reduced-motion: reduce/);
assert.match(assistantSource, /prefers-reduced-motion: reduce/);
assert.match(assistantSource, /grid-template-columns 210ms ease/);

// 13. Collapse code never mutates scrollTop or calls scrollTo.
assert.doesNotMatch(sidebarSource, /scrollTop\s*=|scrollTo\s*\(/);
assert.doesNotMatch(assistantSource, /historySidebarCollapsed[\s\S]{0,200}(scrollTop\s*=|scrollTo\s*\()/);
assert.match(composableSource, /focus\(\{ preventScroll: true \}\)/);
assert.match(assistantSource, /ref="draftPrimaryHeading" tabindex="-1"/);
assert.match(assistantSource, /selectedOutline\.value\?\.outlineId \? 'completed' : 'idle'/);
assert.match(assistantSource, /aria-label="打开历史事件"/);
assert.match(assistantSource, /@media \(max-width: 1099px\)[\s\S]*\.draft-mobile-history-trigger/);
assert.match(assistantSource, /<aside v-if="!historyNavigationMode" class="draft-panel draft-left"/);

// 14. Generation failure does not auto-collapse.
assert.equal(shouldAutoCollapseHistory({ currentStep: 3, draftStatus: 'failed' }), false);

console.log('frontend history sidebar tests passed');
