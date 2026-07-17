# Draft Outline Unified Floating Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the outline back and confirm actions into the existing fixed AI revision dock so all three actions stay available while the user scrolls.

**Architecture:** Keep all behavior inside `DraftOutlineEditor.vue` and preserve the existing emitted events and disabled expressions. Restructure the dock into left action, AI editing group, and right action, then use a mobile-only grid arrangement to place the AI field above a three-button action row.

**Tech Stack:** Vue 3 single-file components, scoped CSS, Node assertions executed with `tsx`, Vite.

## Global Constraints

- Frontend only; do not change API clients or backend services.
- Preserve the existing `back`, `revise`, `confirm`, `update:feedback`, focus expansion, and disabled-state behavior.
- The unified action bar must remain fixed while scrolling.
- Desktop uses one row; mobile uses an AI input row and a button row without horizontal overflow.

---

### Task 1: Unify Outline Actions In The Floating Dock

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`

**Interfaces:**
- Consumes: existing `emit('back')`, `emit('revise')`, `emit('confirm')`, `dockExpanded`, `revising`, `feedback`, and `saveStatus` bindings.
- Produces: one `.draft-ai-revision` fixed dock containing `.draft-dock-back`, `.draft-ai-revision-main`, and `.draft-dock-confirm`; removes `.draft-editor-footer`.

- [ ] **Step 1: Write the failing structure and responsive-style assertions**

Add assertions that require the three dock groups, verify their source order and unique button copy, reject the old footer, and require the mobile grid-area rules:

```ts
const dockStart = outlineEditorSource.indexOf('<section\n      class="draft-ai-revision"');
const dockEnd = outlineEditorSource.indexOf('</section>', dockStart);
const dockSource = outlineEditorSource.slice(dockStart, dockEnd);
assert.ok(dockStart >= 0 && dockEnd > dockStart);
assert.match(dockSource, /class="draft-dock-back"/);
assert.match(dockSource, /class="draft-ai-revision-main"/);
assert.match(dockSource, /class="draft-dock-confirm"/);
assert.ok(dockSource.indexOf('draft-dock-back') < dockSource.indexOf('draft-ai-revision-main'));
assert.ok(dockSource.indexOf('draft-ai-revision-main') < dockSource.indexOf('draft-dock-confirm'));
assert.equal((outlineEditorSource.match(/返回事件分析/g) || []).length, 1);
assert.equal((outlineEditorSource.match(/下一步：确认提纲/g) || []).length, 1);
assert.doesNotMatch(outlineEditorSource, /draft-editor-footer/);
assert.match(outlineEditorSource, /grid-template-areas:\s*"back ai confirm"/);
assert.match(outlineEditorSource, /"ai-title ai-input ai-input"\s*"back revise confirm"/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `.draft-dock-back`, `.draft-ai-revision-main`, and `.draft-dock-confirm` do not exist and `.draft-editor-footer` still exists.

- [ ] **Step 3: Move the actions and add the responsive dock layout**

In `DraftOutlineEditor.vue`, move the existing back button before a new `.draft-ai-revision-main` wrapper, keep the textarea and revise button inside that wrapper, and move the existing confirm button after it. Preserve every current event handler and disabled expression.

Define the desktop dock with:

```css
.draft-ai-revision {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "back ai confirm";
}
.draft-dock-back { grid-area: back; }
.draft-ai-revision-main {
  grid-area: ai;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.draft-dock-confirm { grid-area: confirm; }
```

At `max-width: 760px`, retain the fixed dock and use:

```css
.draft-ai-revision {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-areas:
    "ai-title ai-input ai-input"
    "back revise confirm";
}
.draft-ai-revision-main { display: contents; }
.draft-ai-revision-main > header { grid-area: ai-title; }
.draft-ai-revision-main > :deep(textarea) { grid-area: ai-input; }
.draft-ai-revision-main > button { grid-area: revise; }
```

Allow button text to wrap, keep all three buttons within the viewport, and increase `.draft-outline-editor` bottom padding to `320px` so the final outline item can scroll above the expanded mobile dock.

- [ ] **Step 4: Run focused and adjacent tests and verify GREEN**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-auto-resize-textarea.test.ts
```

Expected: both commands print their `tests passed` messages and exit `0`.

- [ ] **Step 5: Build the production frontend**

Run: `pnpm --dir b_k3ewYvsOEc1 run build`

Expected: Vite reports `built` and exits `0`.

- [ ] **Step 6: Verify desktop and mobile behavior in the browser**

Open the local app in the outline stage. At desktop width, verify the single-row order is back, AI edit, confirm and that the dock remains visible after scrolling. At `390 x 844`, verify the AI field is above the action row, controls do not overlap, there is no horizontal overflow, and the final outline item can scroll above the dock.

- [ ] **Step 7: Commit the implementation**

```bash
git add tests/frontend-draft-workbench.test.ts b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue docs/superpowers/plans/2026-07-17-draft-outline-unified-floating-actions.md
git commit -m "feat: unify draft outline floating actions"
```
