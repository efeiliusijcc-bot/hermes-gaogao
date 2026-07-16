# Draft AI Floating Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the draft outline AI revision control visible while the user scrolls, with a compact default state and an expanded focused state on desktop and mobile.

**Architecture:** Keep the existing `DraftOutlineEditor` event and prop contract unchanged. Add local focus-derived presentation state inside the component, convert the existing revision section into a fixed bottom dock, and reserve matching bottom space in the editor so no outline controls are obscured.

**Tech Stack:** Vue 3 Composition API, scoped CSS, Lucide Vue icons, Node assertion tests, Vite, Vercel.

## Global Constraints

- Modify frontend code only; do not change draft assistant APIs or backend behavior.
- Preserve `feedback`, `revising`, `saveStatus`, and `revise` contracts.
- The dock must remain visible at the top, middle, and bottom of the outline.
- Verify desktop `1440x900` and mobile `390x844` with no horizontal overflow.
- The final section and navigation buttons must scroll fully above the dock.

---

### Task 1: Floating AI Revision Dock

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`

**Interfaces:**
- Consumes: existing `feedback: string`, `revising: boolean`, `saveStatus: string` props and `update:feedback`, `revise` events.
- Produces: local `revisionFocused: Ref<boolean>` and `dockExpanded: ComputedRef<boolean>`; no public API changes.

- [ ] **Step 1: Write the failing source-contract test**

Add these assertions after the existing `AI 修改` assertion in `tests/frontend-draft-workbench.test.ts`:

```ts
assert.match(outlineEditorSource, /const revisionFocused = ref\(false\)/)
assert.match(outlineEditorSource, /const dockExpanded = computed/)
assert.match(outlineEditorSource, /:class="\{ expanded: dockExpanded \}"/)
assert.match(outlineEditorSource, /@focus="revisionFocused = true"/)
assert.match(outlineEditorSource, /@blur="revisionFocused = false"/)
assert.match(outlineEditorSource, /position:\s*fixed/)
assert.match(outlineEditorSource, /padding-bottom:\s*220px/)
```

- [ ] **Step 2: Run the test and verify the missing dock contract fails**

Run `npx tsx tests/frontend-draft-workbench.test.ts`.

Expected: FAIL on the first new assertion because `revisionFocused` does not exist.

- [ ] **Step 3: Add focus-derived expansion state**

Change the Vue import and add local state next to the existing computed values:

```js
import { computed, ref } from 'vue'

const revisionFocused = ref(false)
const dockExpanded = computed(() => (
  revisionFocused.value
  || props.revising
  || Boolean(props.feedback.trim())
))
```

Bind the state to the existing revision section and textarea:

```vue
<section
  class="draft-ai-revision"
  :class="{ expanded: dockExpanded }"
  aria-labelledby="draft-ai-revision-title"
>
  <header>
    <WandSparkles :size="18" aria-hidden="true" />
    <div>
      <h2 id="draft-ai-revision-title">AI 修改</h2>
      <p>输入对当前提纲的修改意见。</p>
    </div>
  </header>
  <AutoResizeTextarea
    :model-value="feedback"
    :disabled="revising"
    :min-height="dockExpanded ? 92 : 42"
    :maxlength="2000"
    aria-label="AI 修改意见"
    placeholder="例如：加强涉我风险分析，合并重复章节"
    @focus="revisionFocused = true"
    @blur="revisionFocused = false"
    @update:model-value="emit('update:feedback', $event)"
  />
  <button type="button" :disabled="revising || !feedback.trim() || saveStatus === 'error'" @click="emit('revise')">
    <LoaderCircle v-if="revising" :size="17" class="spin" aria-hidden="true" />
    <WandSparkles v-else :size="17" aria-hidden="true" />
    {{ revising ? '正在修改' : '应用 AI 修改' }}
  </button>
</section>
```

- [ ] **Step 4: Convert the existing section into a fixed dock and reserve content space**

Use these desktop layout values while retaining the existing color, focus, loading, and disabled styles:

```css
.draft-outline-editor { width: min(1040px, 100%); margin: 0 auto; padding: 18px 0 220px; }
.draft-ai-revision {
  position: fixed;
  left: 50%;
  bottom: 16px;
  z-index: 30;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: min(1040px, calc(100vw - 56px));
  box-sizing: border-box;
  margin: 0;
  border: 1px solid #d8dee7;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(30, 41, 59, 0.14);
  padding: 12px;
  backdrop-filter: blur(12px);
}
.draft-ai-revision > header { display: flex; align-items: center; gap: 8px; min-width: 116px; margin: 0; color: #315f9d; }
.draft-ai-revision > header p { display: none; }
.draft-ai-revision.expanded { align-items: start; }
.draft-ai-revision > button { min-height: 42px; margin: 0; white-space: nowrap; }
.draft-ai-revision :deep(textarea) { max-height: 180px; overflow-y: auto; transition: min-height 160ms ease; }
```

Add these rules inside `@media (max-width: 760px)`:

```css
.draft-outline-editor { padding-bottom: 300px; }
.draft-ai-revision {
  bottom: 8px;
  grid-template-columns: 1fr;
  gap: 8px;
  width: calc(100vw - 16px);
  padding: 10px;
}
.draft-ai-revision > header { min-width: 0; }
.draft-ai-revision > button { width: 100%; justify-content: center; }
.draft-ai-revision :deep(textarea) { max-height: 30vh; }
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run `npx tsx tests/frontend-draft-workbench.test.ts` and `npx tsx tests/frontend-auto-resize-textarea.test.ts`.

Expected: both commands print their `passed` messages and exit `0`.

- [ ] **Step 6: Commit the dock implementation**

```bash
git add tests/frontend-draft-workbench.test.ts b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue
git commit -m "feat: float draft AI revision controls"
```

### Task 2: Responsive Verification and Production Deployment

**Files:**
- Verify: `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`
- Verify: `b_k3ewYvsOEc1/dist/index.html`

**Interfaces:**
- Consumes: the Task 1 dock implementation.
- Produces: a verified production deployment at `https://hermes-gaogao.vercel.app`.

- [ ] **Step 1: Run the complete frontend regression suite**

Run:

```bash
npx tsx tests/frontend-draft-simplified-flow.test.ts
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-auto-resize-textarea.test.ts
```

Expected: all three commands print their `passed` messages and exit `0`.

- [ ] **Step 2: Build the production frontend**

Run `pnpm --dir b_k3ewYvsOEc1 run build`.

Expected: Vite reports `built` and exits `0`.

- [ ] **Step 3: Verify desktop behavior in the browser**

At `1440x900`, open a populated outline and verify:

```text
- The dock is visible at scrollTop 0, the middle of the outline, and the bottom.
- Focusing the textarea expands it; clearing and blurring collapses it.
- The final section and both footer buttons scroll above the dock.
- document.documentElement.scrollWidth equals window.innerWidth.
```

- [ ] **Step 4: Verify mobile behavior in the browser**

At `390x844`, repeat the same checks and verify the dock stacks vertically, the action button spans the available width, and there is no horizontal overflow.

- [ ] **Step 5: Push the feature branch and fast-forward `main` only when it is still an ancestor**

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git push -u origin codex/draft-assistant-chat-ui
git push origin HEAD:main
```

Expected before the final push: the left count is `0`. Expected after the push: Vercel reports `Deployment has completed` for the new commit.

- [ ] **Step 6: Verify the production deployment**

Run `curl -fsSL https://hermes-gaogao.vercel.app` and confirm the production asset names match `b_k3ewYvsOEc1/dist/index.html`. Then open the production URL and verify the floating AI revision dock is visible on the outline editor.
