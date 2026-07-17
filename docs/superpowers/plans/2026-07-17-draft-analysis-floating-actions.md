# Draft Analysis Floating Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the event-analysis back and generate-outline actions visible in one fixed bottom bar while the user reviews long analysis content.

**Architecture:** Preserve the existing `DraftAnalysisView.vue` template, emitted events, loading copy, and disabled expressions. Replace the static `.draft-analysis-actions` layout with a fixed dock and increase the view's bottom padding; use two equal columns at the mobile breakpoint.

**Tech Stack:** Vue 3 single-file components, scoped CSS, Node assertions executed with `tsx`, Vite.

## Global Constraints

- Frontend only; do not change analysis or outline-generation flows.
- Preserve the existing `back`, `generate`, and `retry` event handlers and button disabled expressions.
- Desktop dock width is `min(840px, calc(100vw - 56px))`.
- Mobile uses two equal columns without horizontal overflow.

---

### Task 1: Float Event Analysis Actions

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue`

**Interfaces:**
- Consumes: existing `loading`, `generating`, `error`, `emit('back')`, and `emit('generate')` bindings.
- Produces: a fixed `.draft-analysis-actions` dock with unchanged button behavior.

- [ ] **Step 1: Add failing source assertions**

Require `.draft-analysis-actions` to use fixed positioning, the `840px` desktop width, mobile equal columns, and `160px` desktop bottom padding. Also assert the action labels remain unique and ordered.

- [ ] **Step 2: Verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `.draft-analysis-actions` is statically positioned and the view has only `56px` bottom padding.

- [ ] **Step 3: Implement the fixed dock**

Set `.draft-analysis-view` to `padding: 26px 0 160px`. Define `.draft-analysis-actions` with `position: fixed`, centered `left: 50%`, `bottom: 16px`, `z-index: 30`, `width: min(840px, calc(100vw - 56px))`, `transform: translateX(-50%)`, and the same surface treatment as the existing draft floating docks.

At `max-width: 640px`, set `.draft-analysis-view` to `padding: 14px 0 190px`, use `grid-template-columns: repeat(2, minmax(0, 1fr))`, set dock width to `calc(100vw - 16px)`, and let button text wrap.

- [ ] **Step 4: Verify tests and build**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-draft-simplified-flow.test.ts
pnpm --dir b_k3ewYvsOEc1 run build
```

Expected: both tests pass and Vite exits `0`.

- [ ] **Step 5: Verify responsive behavior**

Render long analysis content at `1238 x 994` and `390 x 844`. Confirm the dock remains fixed while scrolling, buttons remain left/right, the mobile page has no horizontal overflow, and the final analysis section can scroll above the dock.

- [ ] **Step 6: Commit**

```bash
git add tests/frontend-draft-workbench.test.ts b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue design-qa.md docs/superpowers/plans/2026-07-17-draft-analysis-floating-actions.md
git commit -m "feat: float draft analysis actions"
```
