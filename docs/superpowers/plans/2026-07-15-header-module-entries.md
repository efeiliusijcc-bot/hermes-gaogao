# Header Module Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the centered collapsible workspace switcher with four direct module entries beside the left-side product title.

**Architecture:** Keep `NexusHeader.vue` as the owner of module visibility and event emission while replacing only its collapsible presentation. Keep `App.vue` and its `switchWorkspace(mode)` behavior unchanged; CSS moves the navigation into the left header flow and provides a single-line scrollable mobile row.

**Tech Stack:** Vue 3 Single File Components, CSS, Node.js assertions via `tsx`, Vite.

## Global Constraints

- Preserve `visibleWorkspaceItems`, `currentWorkspace`, and the `switch-workspace` event contract.
- Do not change report, QA, Daily Awareness, Draft Assistant, authentication, or authorization behavior.
- Desktop and tablet entries remain on one line; narrow screens use one horizontally scrollable line.
- Preserve `tablist`, `tab`, and `aria-selected` semantics.

---

### Task 1: Direct Header Module Navigation

**Files:**
- Create: `tests/frontend-header-module-entries.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/NexusHeader.vue`
- Modify: `b_k3ewYvsOEc1/src/styles/main.css`

**Interfaces:**
- Consumes: `visibleWorkspaceItems`, `currentWorkspace`, and `emit('switch-workspace', key)` from `NexusHeader.vue`.
- Produces: a permanently visible `.header-module-nav` tab list containing `.header-module-entry` buttons.

- [x] **Step 1: Write the failing source regression test**

```ts
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
```

- [x] **Step 2: Run the test and verify the old collapsible Header fails**

Run: `npx tsx tests/frontend-header-module-entries.test.ts`

Expected: FAIL because `class="header-module-nav"` is absent.

- [x] **Step 3: Replace the collapsible Header markup and remove its local interaction state**

In `NexusHeader.vue`, place this navigation directly after the product title inside `.header-brand`:

```vue
<nav class="header-module-nav" role="tablist" aria-label="功能模块导航">
  <button
    v-for="item in visibleWorkspaceItems"
    :key="item.key"
    class="header-module-entry"
    :class="{ active: item.key === currentWorkspace }"
    type="button"
    role="tab"
    :aria-selected="item.key === currentWorkspace"
    @click="emit('switch-workspace', item.key)"
  >
    {{ item.title }}
  </button>
</nav>
```

Remove `workspaceNavRef`, `workspaceNavOpen`, the open/close/toggle helper functions, workspace-specific document click/Escape handling, and the centered `.header-center` template block.

- [x] **Step 4: Add ordinary tab styling and mobile overflow**

In `main.css`, replace the Header-specific centered switcher rules with `.header-module-nav` and `.header-module-entry` styles. Keep tabs compact, neutral, non-wrapping, and blue when active. Under `@media (max-width: 768px)`, make `.header-brand` span the full row and set `.header-module-nav { overflow-x: auto; }` without wrapping.

- [x] **Step 5: Run the focused test and build**

Run: `npx tsx tests/frontend-header-module-entries.test.ts`

Expected: PASS with `frontend header module entry tests passed`.

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: Vite production build exits with status 0.

- [x] **Step 6: Check formatting and inspect desktop/mobile layouts**

Run: `git diff --check`

Expected: no output.

Start the frontend with `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 dev --host 127.0.0.1`, then inspect at `1440x900` and `390x844`. Confirm the four entries appear beside the title on desktop, form a scrollable second row on mobile, preserve active styling, and do not overlap the account controls.

- [x] **Step 7: Commit the implementation**

```bash
git add tests/frontend-header-module-entries.test.ts \
  b_k3ewYvsOEc1/src/components/NexusHeader.vue \
  b_k3ewYvsOEc1/src/styles/main.css \
  docs/superpowers/plans/2026-07-15-header-module-entries.md
git commit -m "feat: show direct header module entries"
```
