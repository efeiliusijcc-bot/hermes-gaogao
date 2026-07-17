# Draft History Header Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the draft assistant header back button with an always-available history shortcut and remove the duplicate right-side history button.

**Architecture:** Reuse the existing `historyOpen` state and `DraftHistorySidebar`. Simplify the header to a stable three-column grid: left history button, centered title, right spacer; remove state and handlers that only supported the old header controls.

**Tech Stack:** Vue 3, Lucide Vue, Node assertion tests, Vite, Vercel.

## Global Constraints

- Frontend-only change.
- Keep history loading, selection, and drawer events unchanged.
- Disable the history shortcut while `stage === 'importing'`.
- Keep the title centered on desktop and mobile.

---

### Task 1: Replace the Header Control

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`

**Interfaces:**
- Consumes: existing `historyOpen` state and `DraftHistorySidebar`.
- Produces: one left-side `查看历史编报` button; no backend or API changes.

- [ ] **Step 1: Add failing source-contract tests**

Add these assertions to `tests/frontend-draft-workbench.test.ts`:

```ts
assert.doesNotMatch(assistantSource, /返回工作台/)
assert.doesNotMatch(assistantSource, /canShowHistory/)
assert.doesNotMatch(assistantSource, /handleBack/)
assert.match(assistantSource, /aria-label="查看历史编报"/)
assert.equal((assistantSource.match(/<History/g) || []).length, 1)
assert.match(assistantSource, /<span class="draft-bar-spacer"/)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npx tsx tests/frontend-draft-workbench.test.ts`.

Expected: FAIL because `返回工作台` is still present.

- [ ] **Step 3: Simplify the component state and imports**

Change the icon import to:

```js
import { Check, History, LoaderCircle, Pencil } from '@lucide/vue'
```

Delete:

```js
const canShowHistory = computed(() => stage.value !== 'input')
```

Delete the unused function while leaving the existing public emit declaration unchanged for parent compatibility:

```js
async function handleBack() {
  if (!(await flushBeforeLeaving())) return
  emit('back')
}
```

- [ ] **Step 4: Replace the header template**

Use this header:

```vue
<header class="draft-assistant-bar">
  <button
    type="button"
    aria-label="查看历史编报"
    title="历史编报"
    :disabled="stage === 'importing'"
    @click="historyOpen = true"
  >
    <History :size="19" aria-hidden="true" />
  </button>
  <strong>拟稿助手</strong>
  <span class="draft-bar-spacer" aria-hidden="true"></span>
</header>
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx tsx tests/frontend-draft-simplified-flow.test.ts
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-auto-resize-textarea.test.ts
pnpm --dir b_k3ewYvsOEc1 run build
```

Expected: all tests and the Vite build exit `0`.

- [ ] **Step 6: Verify and deploy**

Verify in the browser at `1440x900` and `390x844` that the input page left button opens history, no duplicate history button exists, and the title is centered. Commit, push the feature branch, fast-forward `main` only when `origin/main` remains an ancestor, wait for Vercel success, and confirm production assets match the local build.
