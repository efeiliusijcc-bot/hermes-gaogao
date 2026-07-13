# Draft Assistant Round One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first-round progressive Draft Assistant workbench with stage-adaptive columns, a useful Step 1 preview, explicit step states, full-width strategy tabs, a step-aware right panel, Step 5 coverage, and readable outline rows without changing business contracts.

**Architecture:** Keep `DraftAssistant.vue` as the workflow coordinator and API owner. Extract deterministic presentation state into `draftWorkbench.js` and move bounded visual surfaces into Vue components that consume props and emit intent events. Reuse the existing history-sidebar composable, editor toolbar, API handlers, version structures, save guards, and permissions.

**Tech Stack:** Vue 3 Composition API, Vite 6, JavaScript modules, Node/TSX assertion tests, existing project CSS and API helpers.

## Global Constraints

- Preserve the five-step flow, API payloads, `useReportJobs.js`, version structures, permission checks, owner isolation, and import behavior.
- Do not introduce background save requests or reinterpret `manualUpdateDraftOutline`; only `保存为新版本` creates a version.
- Do not add new pointer drag-and-drop, undo behavior, or editing shortcuts in Round One.
- Preserve any pre-existing behavior in `StrategyTabs.vue`; Round One only adds a non-editable presentation mode and integration.
- Use only the existing blue, gray-blue, white, green, orange, and red visual language; no purple, gradients, dark-tech theme, neon, or glassmorphism.
- At 1440px, 1280px, and 1024px, the page must not create horizontal document overflow.
- Keep unrelated dirty worktree files unstaged and unchanged.

---

### Task 1: Deterministic Workbench Presentation State

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/draftWorkbench.js`
- Create: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- Produces: `parseEventLinks(text)`, `eventInputSummary(form)`, `deriveDraftStepStates(state)`, `draftContextSections(step)`, and `deriveMaterialCoverage(state)`.
- Consumes: plain objects and arrays only; no Vue or API dependencies.

- [ ] **Step 1: Write failing helper tests**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseEventLinks,
  eventInputSummary,
  deriveDraftStepStates,
  draftContextSections,
  deriveMaterialCoverage,
} from '../b_k3ewYvsOEc1/src/lib/draftWorkbench.js';

const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);

assert.deepEqual(parseEventLinks('https://a.example\ninvalid'), {
  valid: ['https://a.example/'],
  invalid: ['invalid'],
});
assert.equal(eventInputSummary({ title: '事件', materials: '', linksText: '', category: '', region: '' }).canAnalyze, true);
assert.equal(eventInputSummary({ title: '事件', materials: '', linksText: '', category: '', region: '' }).completion, 20);
assert.equal(deriveDraftStepStates({ currentStep: 'confirm', hasAnalysis: true, hasOutline: true, hasEditChanges: true })[3].status, 'needs_attention');
assert.deepEqual(draftContextSections('input'), ['guidance', 'completion', 'recent']);
assert.deepEqual(draftContextSections('confirm'), ['revision', 'versions', 'next']);
assert.equal(deriveMaterialCoverage({ materials: '', validLinks: [], importedPlan: null }).label, '待补充');
assert.equal(deriveMaterialCoverage({ materials: '背景', validLinks: ['https://a.example/', 'https://b.example/'], importedPlan: null }).label, '资料较完整');
assert.equal(deriveMaterialCoverage({ materials: '', validLinks: [], importedPlan: { planId: 'p1' } }).label, '已形成导入计划');
assert.equal(deriveMaterialCoverage({}).collectedSourceCountLabel, '未提供');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `draftWorkbench.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

```js
export function parseEventLinks(text) {
  const valid = []
  const invalid = []
  String(text || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
    try {
      const url = new URL(item)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported')
      valid.push(url.toString())
    } catch {
      invalid.push(item)
    }
  })
  return { valid, invalid }
}

export function eventInputSummary(form = {}) {
  const links = parseEventLinks(form.linksText)
  const fields = {
    title: Boolean(String(form.title || '').trim()),
    materials: Boolean(String(form.materials || '').trim()),
    links: links.valid.length > 0,
    category: Boolean(String(form.category || '').trim()),
    region: Boolean(String(form.region || '').trim()),
  }
  const labels = { title: '事件标题', materials: '补充材料', links: '相关链接', category: '类别', region: '地区' }
  return {
    canAnalyze: fields.title,
    completion: Object.values(fields).filter(Boolean).length * 20,
    filled: Object.keys(fields).filter((key) => fields[key]).map((key) => labels[key]),
    missing: Object.keys(fields).filter((key) => !fields[key]).map((key) => labels[key]),
    links,
  }
}

const STATUS_LABELS = {
  current: '进行中',
  completed: '已完成',
  needs_attention: '需要处理',
  processing: '处理中',
  failed: '失败',
  not_started: '未开始',
}

export function deriveDraftStepStates(state = {}) {
  const definitions = [
    { key: 'input', title: '事件输入' },
    { key: 'analysis', title: '事件分析' },
    { key: 'outline', title: '拟稿提纲' },
    { key: 'confirm', title: '确认版本' },
    { key: 'import', title: '导入深度编报' },
  ]
  const currentIndex = Math.max(0, definitions.findIndex((item) => item.key === state.currentStep))
  return definitions.map((item, index) => {
    let status = index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'not_started'
    if (item.key === 'analysis' && state.isAnalyzing) status = 'processing'
    if (item.key === 'outline' && (state.isGeneratingOutline || state.isRefining)) status = 'processing'
    if (item.key === 'outline' && state.draftStatus === 'failed') status = 'failed'
    if (item.key === 'confirm' && state.hasEditChanges) status = 'needs_attention'
    if (item.key === 'import' && (state.isImportingOutline || state.isCreatingReportJob)) status = 'processing'
    if (item.key === 'import' && state.createdReportJob) status = 'completed'
    return { ...item, status, statusLabel: STATUS_LABELS[status] }
  })
}

export function draftContextSections(step) {
  return {
    input: ['guidance', 'completion', 'recent'],
    analysis: ['reanalyze', 'materials', 'generate'],
    outline: ['revision', 'versions', 'preview'],
    confirm: ['revision', 'versions', 'next'],
    import: ['instructions', 'coverage', 'import'],
  }[step] || []
}

export function deriveMaterialCoverage(state = {}) {
  const materials = Boolean(String(state.materials || '').trim())
  const validLinkCount = Array.isArray(state.validLinks) ? state.validLinks.length : 0
  const imported = Boolean(state.importedPlan?.planId)
  const label = imported
    ? '已形成导入计划'
    : materials && validLinkCount >= 2
      ? '资料较完整'
      : materials || validLinkCount > 0
        ? '基础资料'
        : '待补充'
  const collectedSourceCountLabel = Array.isArray(state.collectedSources)
    ? String(state.collectedSources.length)
    : Number.isFinite(state.collectedSourceCount)
      ? String(state.collectedSourceCount)
      : '未提供'
  return { label, validLinkCount, collectedSourceCountLabel }
}
```

Do not import Vue state or call APIs.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: `frontend draft workbench tests passed`.

- [ ] **Step 5: Commit the helper cycle**

```bash
git add b_k3ewYvsOEc1/src/lib/draftWorkbench.js tests/frontend-draft-workbench.test.ts
git commit -m "test: define draft workbench presentation state"
```

---

### Task 2: Accessible Five-Step Navigation

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- Consumes: `steps: Array<{ key, title, status, statusLabel }>` from `deriveDraftStepStates`.
- Produces: semantic step navigation with `aria-current="step"` and textual status labels.

- [ ] **Step 1: Add failing source-contract assertions**

```ts
const navigationSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue', import.meta.url),
  'utf8',
);
assert.match(navigationSource, /aria-current/);
assert.match(navigationSource, /step\.statusLabel/);
assert.match(navigationSource, /role="list"/);
assert.match(navigationSource, /completed/);
assert.match(navigationSource, /needs_attention/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `DraftStepNavigation.vue` does not exist.

- [ ] **Step 3: Implement and integrate the component**

Use this public shape:

```vue
<DraftStepNavigation :steps="draftStepStates" />
```

Replace only the existing `<nav class="draft-stepper">` markup. Keep `currentStepKey` and all workflow transitions in `DraftAssistant.vue`. Add a computed `draftStepStates` that passes existing flags to `deriveDraftStepStates`.

- [ ] **Step 4: Run helper/source tests and existing history tests**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-history-sidebar.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit the navigation cycle**

```bash
git add b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue b_k3ewYvsOEc1/src/components/DraftAssistant.vue tests/frontend-draft-workbench.test.ts
git commit -m "feat: add draft workflow step states"
```

---

### Task 3: Step 1 Source Panel And Live Preview

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/EventSourcePanel.vue`
- Create: `b_k3ewYvsOEc1/src/components/EventPreviewPanel.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- `EventSourcePanel` consumes `modelValue`, `summary`, `events`, `currentEventId`, and `loading`; emits `update:modelValue`, `refresh`, `select-event`, and `create-event`.
- `EventPreviewPanel` consumes `form`, `summary`, and `analyzing`; emits `analyze`.
- Parent remains responsible for calling `runAnalyze`, `loadEvents`, `openEvent`, and `startNewEvent`.

- [ ] **Step 1: Add failing Step 1 source assertions**

```ts
const sourcePanel = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/EventSourcePanel.vue', import.meta.url), 'utf8');
const previewPanel = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/EventPreviewPanel.vue', import.meta.url), 'utf8');
assert.match(sourcePanel, /事件信息完整度/);
assert.match(sourcePanel, /maxlength="60"/);
assert.match(sourcePanel, /有效链接/);
assert.match(previewPanel, /事件输入预览/);
assert.match(previewPanel, /系统将执行/);
assert.match(previewPanel, /开始事件分析/);
assert.match(previewPanel, /当前资料较少/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the source panel without API ownership**

Use `updateField(key, value)` to emit a copied model object:

```js
function updateField(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
```

Render field counts, valid/invalid-link feedback, completion, filled/missing labels, and the existing event history. Do not replace the API payload keys.

- [ ] **Step 4: Implement the live preview and wire existing handlers**

The center preview shows the title, category, region, material excerpt, valid-link count, the five analysis outcomes, sparse-material notice, and the primary action. In `DraftAssistant.vue`, use:

```vue
<EventSourcePanel
  v-if="currentStepKey === 'input'"
  :model-value="form"
  :summary="eventInput"
  :events="eventList"
  :loading="isLoadingEvents"
  @update:model-value="Object.assign(form, $event)"
  @refresh="loadEvents"
  @select-event="openEvent"
/>
<EventPreviewPanel
  v-if="currentStepKey === 'input'"
  :form="form"
  :summary="eventInput"
  :analyzing="isAnalyzing"
  @analyze="runAnalyze"
/>
```

Keep `runAnalyze` unchanged except that it may use `eventInput.links.valid` instead of the old permissive parser. Invalid links remain visible and do not produce technical exceptions.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-risk-summary.test.ts
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit the Step 1 cycle**

```bash
git add b_k3ewYvsOEc1/src/components/EventSourcePanel.vue b_k3ewYvsOEc1/src/components/EventPreviewPanel.vue b_k3ewYvsOEc1/src/components/DraftAssistant.vue tests/frontend-draft-workbench.test.ts
git commit -m "feat: add draft event input workbench"
```

---

### Task 4: Full-Width Strategy Tabs And Readable Outline Rows

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftOutlineView.vue`
- Modify: `b_k3ewYvsOEc1/src/components/StrategyTabs.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- `StrategyTabs` gains `editable: Boolean = true`; `editable=false` hides add/edit/delete/drag controls but keeps tab counts and full text.
- `DraftOutlineView` consumes `outline` and emits `edit` only. It renders a visual handle, complete wrapping text, and a compact menu whose display-mode action enters the existing full-outline edit mode.
- The existing editable outline rows replace visible text-button clusters with a compact menu that emits the existing move/remove actions plus a local duplicate action. The handle remains an affordance only; no new pointer drag behavior is added.
- Existing editing-mode events and `StrategyTabs` behavior remain unchanged.

- [ ] **Step 1: Add failing tab and outline assertions**

```ts
const strategySource = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/StrategyTabs.vue', import.meta.url), 'utf8');
const outlineViewSource = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/DraftOutlineView.vue', import.meta.url), 'utf8');
assert.match(strategySource, /editable/);
assert.match(strategySource, /role="tabpanel"/);
assert.doesNotMatch(outlineViewSource, /text-overflow:\s*ellipsis/);
assert.match(outlineViewSource, /overflow-wrap:\s*anywhere/);
assert.match(outlineViewSource, /aria-label="更多提纲操作"/);
assert.match(assistantSource, /aria-label="更多目录操作"/);
assert.match(assistantSource, /duplicateOutlineItem/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `DraftOutlineView.vue` does not exist and `editable` is absent.

- [ ] **Step 3: Add read-only strategy mode**

Guard existing mutation affordances with `v-if="editable"`. Do not change existing drag, undo, Ctrl/Cmd+Enter, or Escape handlers. Render complete `itemText(item)` without the old 72-character truncation.

- [ ] **Step 4: Add the outline view and integrate it**

Replace the display-only `.draft-directory` markup with:

```vue
<DraftOutlineView :outline="displayOutline" @edit="enterEditMode" />
<StrategyTabs
  :writing-focus="displayOutline.writingFocus"
  :source-requirements="displayOutline.sourceRequirements"
  :uncertainties-to-verify="displayOutline.uncertaintiesToVerify"
  :editable="false"
/>
```

In the editable outline form, add a single per-row menu trigger with `aria-label="更多目录操作"`. Its menu invokes `moveOutlineItem(index, -1)`, `moveOutlineItem(index, 1)`, `duplicateOutlineItem(index)`, and `removeOutlineItem(index)`. Implement duplication as a local edit-state operation:

```js
function duplicateOutlineItem(index) {
  const item = outlineEdit.outlineItems[index]
  if (!item) return
  outlineEdit.outlineItems.splice(index + 1, 0, cloneOutlineItems([item])[0])
}
```

Do not add pointer drag handlers or undo state.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-history-sidebar.test.ts
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Expected: all pass.

- [ ] **Step 6: Commit the outline cycle**

```bash
git add b_k3ewYvsOEc1/src/components/DraftOutlineView.vue b_k3ewYvsOEc1/src/components/StrategyTabs.vue b_k3ewYvsOEc1/src/components/DraftAssistant.vue tests/frontend-draft-workbench.test.ts
git commit -m "feat: widen draft outline and strategy views"
```

---

### Task 5: Step-Aware Right Panel And Step 5 Coverage

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftContextPanel.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- Consumes existing values for current step, input summary, coverage, versions, selected outline, import state, permission, and loading flags.
- Emits `generate-outline`, `refine`, `edit`, `confirm`, `select-version`, `import-outline`, `create-report`, `open-right`, and `close`.
- Does not call APIs or mutate versions.

- [ ] **Step 1: Add failing dynamic-panel assertions**

```ts
const contextSource = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/DraftContextPanel.vue', import.meta.url), 'utf8');
assert.match(contextSource, /currentStep === 'input'/);
assert.match(contextSource, /currentStep === 'analysis'/);
assert.match(contextSource, /currentStep === 'outline'/);
assert.match(contextSource, /currentStep === 'confirm'/);
assert.match(contextSource, /currentStep === 'import'/);
assert.match(contextSource, /已采集资料数量/);
assert.match(contextSource, /collectedSourceCountLabel/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL because `DraftContextPanel.vue` does not exist.

- [ ] **Step 3: Implement five explicit panel branches**

Render only the approved sections for the active step. Relevant actions may show a concise enabling-condition message; future-step controls must not remain as disabled button stacks. Preserve existing labels for permission errors and import identifiers.

- [ ] **Step 4: Wire emits to existing parent handlers**

Replace only the right-panel template. Map emitted intents to existing functions such as `createOutline`, `refineOutline`, `enterEditMode`, `confirmCurrentVersion`, `loadOutline`, `importCurrentOutline`, and `createDeepReportJob`.

Compute coverage with:

```js
const materialCoverage = computed(() => deriveMaterialCoverage({
  materials: form.materials,
  validLinks: eventInput.value.links.valid,
  importedPlan: importedPlan.value,
  collectedSources: eventResult.value?.sources,
}))
```

Do not add a source request when `eventResult.sources` is absent.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-permission-modules.test.ts
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Expected: all pass.

- [ ] **Step 6: Commit the context-panel cycle**

```bash
git add b_k3ewYvsOEc1/src/components/DraftContextPanel.vue b_k3ewYvsOEc1/src/components/DraftAssistant.vue tests/frontend-draft-workbench.test.ts
git commit -m "feat: make draft actions step aware"
```

---

### Task 6: Round One Integration And Regression Gate

**Files:**
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftEditorToolbar.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue` only if a verified Round One breakpoint issue requires it
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- Preserves all existing API calls and handler signatures.
- Produces the approved stage-adaptive three-column layout and responsive drawer controls.

- [ ] **Step 1: Add failing integration assertions**

```ts
const toolbarSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftEditorToolbar.vue', import.meta.url),
  'utf8',
);
assert.match(assistantSource, /history-collapsed/);
assert.match(assistantSource, /DraftContextPanel/);
assert.match(assistantSource, /DraftStepNavigation/);
assert.match(assistantSource, /EventPreviewPanel/);
assert.match(toolbarSource, /min-height:\s*68px/);
assert.doesNotMatch(assistantSource, /draft-strategy-grid/);
assert.doesNotMatch(assistantSource, /setTimeout\([^)]*manualUpdateDraftOutline/);
```

- [ ] **Step 2: Run and verify RED for remaining integration gaps**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL only on integration contracts not yet met.

- [ ] **Step 3: Complete layout integration minimally**

Remove obsolete Step 1 empty-state, old three-column strategy display, and always-visible right-panel markup after their replacements are wired. Keep the Step 4 toolbar at 68px and remove any purple or gradient styling encountered in the touched surfaces. Do not modify API functions, save handlers, or permission computed values.

- [ ] **Step 4: Run the complete automated regression set**

Run:

```bash
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-history-sidebar.test.ts
npx tsx tests/frontend-risk-summary.test.ts
npx tsx tests/frontend-permission-modules.test.ts
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
git diff --check
```

Expected: all tests pass, Vite build exits 0, and diff check has no output.

- [ ] **Step 5: Browser-verify real workflow states**

At 1440x1024, 1280x800, and 1024x768 verify:

- Step 1 live preview and title-gated primary action;
- Step 2 structured analysis and risk cards;
- Step 3 64px history rail, full-width strategy tabs, and readable outline text;
- Step 4 sticky toolbar, existing save-new-version semantics, and unsaved guard;
- Step 5 coverage labels and import controls;
- right-panel controls change by step;
- document and workbench have no horizontal overflow;
- panel controls remain reachable and center scroll is preserved through sidebar toggles;
- no new console errors.

- [ ] **Step 6: Commit Round One integration**

```bash
git add b_k3ewYvsOEc1/src/components b_k3ewYvsOEc1/src/lib/draftWorkbench.js tests/frontend-draft-workbench.test.ts
git commit -m "feat: complete draft assistant workbench round one"
```
