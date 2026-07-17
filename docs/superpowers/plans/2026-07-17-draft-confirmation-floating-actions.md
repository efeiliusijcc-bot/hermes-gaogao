# Draft Confirmation Floating Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the confirmation page back and create actions visible in one fixed bottom bar while the user reviews a long outline.

**Architecture:** Preserve the existing confirmation-stage template and event handlers, add a dedicated `draft-confirm-actions` class to its footer, and replace the static footer layout with fixed positioning. Use a two-column mobile layout and increase confirmation-page bottom padding so content can scroll clear of the bar.

**Tech Stack:** Vue 3 single-file components, scoped CSS, Node assertions executed with `tsx`, Vite.

## Global Constraints

- Frontend only; do not change API clients, import flow, or backend services.
- Preserve `stage = 'outline'` and `importToDeepReport` click handlers exactly.
- The action bar remains fixed while scrolling.
- Desktop uses left/right actions; mobile keeps both buttons in one row without horizontal overflow.

---

### Task 1: Float Confirmation Actions

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`

**Interfaces:**
- Consumes: existing confirmation stage, `stage = 'outline'`, and `importToDeepReport`.
- Produces: a `.draft-confirm-actions` fixed footer containing the existing secondary and primary buttons.

- [ ] **Step 1: Write failing confirmation-action assertions**

Add assertions that scope the confirmation stage and require the dedicated class, fixed positioning, desktop width, mobile two-column layout, and confirmation-page bottom padding:

```ts
const confirmStageStart = assistantSource.indexOf("stage === 'confirm'");
const confirmStageEnd = assistantSource.indexOf('<DraftImportState', confirmStageStart);
const confirmStageSource = assistantSource.slice(confirmStageStart, confirmStageEnd);
assert.ok(confirmStageStart >= 0 && confirmStageEnd > confirmStageStart);
assert.match(confirmStageSource, /<footer class="draft-confirm-actions">/);
assert.ok(confirmStageSource.indexOf('返回修改') < confirmStageSource.indexOf('确认并创建深度编报'));
assert.match(assistantSource, /\.draft-confirm-actions\s*\{[^}]*position:\s*fixed/);
assert.match(assistantSource, /width:\s*min\(920px,\s*calc\(100vw - 56px\)\)/);
assert.match(assistantSource, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(assistantSource, /\.draft-confirmation\s*\{[^}]*padding:\s*24px 0 160px/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because the footer has no `draft-confirm-actions` class and still uses static positioning.

- [ ] **Step 3: Implement the fixed footer**

Add `class="draft-confirm-actions"` to the confirmation footer. Define it with `position: fixed`, centered `left: 50%`, `bottom: 16px`, `z-index: 30`, `width: min(920px, calc(100vw - 56px))`, `transform: translateX(-50%)`, two actions separated with `justify-content: space-between`, and the same surface treatment as the outline edit dock.

Change `.draft-confirmation` to `padding: 24px 0 160px`. At `max-width: 640px`, use `grid-template-columns: repeat(2, minmax(0, 1fr))`, set the dock width to `calc(100vw - 16px)`, make both buttons fill their columns, allow text wrapping, and use `padding-bottom: 190px` on the confirmation page.

- [ ] **Step 4: Run focused and adjacent tests**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-draft-simplified-flow.test.ts
```

Expected: both commands print their `tests passed` messages and exit `0`.

- [ ] **Step 5: Build the production frontend**

Run: `pnpm --dir b_k3ewYvsOEc1 run build`

Expected: Vite reports `built` and exits `0`.

- [ ] **Step 6: Verify desktop and mobile behavior**

Render a long confirmation outline locally. At `1238 x 994`, verify the dock remains visible after scrolling and the buttons stay left/right. At `390 x 844`, verify the two buttons remain side by side, text does not overflow, there is no horizontal scrolling, and the last outline section can scroll above the dock.

- [ ] **Step 7: Commit**

```bash
git add tests/frontend-draft-workbench.test.ts b_k3ewYvsOEc1/src/components/DraftAssistant.vue design-qa.md docs/superpowers/plans/2026-07-17-draft-confirmation-floating-actions.md
git commit -m "feat: float draft confirmation actions"
```
