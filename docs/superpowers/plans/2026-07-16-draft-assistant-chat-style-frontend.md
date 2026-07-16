# Chat-Style Draft Assistant Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dense draft-assistant workbench with a ChatGPT-inspired, five-stage frontend that uses one source input, a compact history drawer, a directly editable current outline, autosave, read-only confirmation, and automatic deep-report handoff.

**Architecture:** Keep every existing backend API unchanged. Add pure flow helpers and a serialized autosave queue, extract focused Vue components for the source composer, analysis, outline editor, and import state, then reduce `DraftAssistant.vue` to workflow orchestration. The UI treats every server response as the current outline and never loads or displays the hidden version history.

**Tech Stack:** Vue 3 Composition API, Vite 6, plain JavaScript modules, `lucide-vue-next`, Node `assert` test scripts, existing draft-assistant REST APIs.

## Global Constraints

- Modify only frontend code, frontend dependencies, frontend tests, and implementation documentation.
- Do not change NestJS controllers, services, database migrations, or SQL.
- Do not display V1/V2/V3, version timelines, restore actions, version comparison, event category, region, completeness, suggestions, or an import configuration form.
- Do not render a fake delete-history action because no delete API exists.
- Do not show history or a stepper on the input stage.
- History is available only after analysis begins and is closed by default.
- Continue to emit `report-job-created` after creating the deep-report job so `App.vue` keeps handling navigation.
- Use ASCII in JavaScript identifiers and Chinese only for user-facing copy already used by this application.

---

## File Structure

**Create**

- `b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js`: source-input mapping, five analysis sections, history filtering, and restored-stage derivation.
- `b_k3ewYvsOEc1/src/lib/draftAutosave.js`: framework-independent debounced serialized save queue.
- `b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue`: stage-one source input.
- `b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue`: stage-two conversational analysis.
- `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`: stage-three direct outline editor and AI revision composer.
- `b_k3ewYvsOEc1/src/components/DraftImportState.vue`: stage-five progress, error, and retry state.
- `tests/frontend-draft-simplified-flow.test.ts`: pure helper and source-contract regression tests.

**Modify**

- `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`: replace the legacy multi-panel/version workflow with stage orchestration.
- `b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue`: convert the card/rail sidebar into a closed-by-default overlay drawer.
- `b_k3ewYvsOEc1/src/components/DraftOutlineView.vue`: make confirmation strictly read-only and remove edit/version affordances.
- `b_k3ewYvsOEc1/src/lib/draftWorkbench.js`: remove legacy step/context exports after callers migrate; retain reusable URL and outline-independent helpers only when still referenced.
- `b_k3ewYvsOEc1/package.json`: add `lucide-vue-next`.
- `b_k3ewYvsOEc1/pnpm-lock.yaml`: lock the icon dependency.
- `tests/frontend-draft-workbench.test.ts`: replace legacy layout assertions with simplified-flow assertions.
- `tests/frontend-auto-resize-textarea.test.ts`: assert the source and AI feedback composers use the existing autosizing control.

**Retain but stop rendering from the main workflow**

- `DraftContextPanel.vue`
- `DraftEditorToolbar.vue`
- `DraftStepNavigation.vue`
- `EventPreviewPanel.vue`
- `EventSourcePanel.vue`
- `StrategyTabs.vue`

Deleting these files is outside this plan because other pending work or future rollback may still reference them; removal can happen only after repository-wide reference checks show zero consumers.

---

### Task 1: Source Mapping and Flow Helpers

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js`
- Create: `tests/frontend-draft-simplified-flow.test.ts`

**Interfaces:**
- Produces: `buildDraftAnalyzePayload(sourceInput: string)` returning the unchanged analyze API payload.
- Produces: `buildDraftAnalysisSections(eventResult: object)` returning exactly five display sections.
- Produces: `filterDraftHistory(events: object[], query: string)`.
- Produces: `restoredDraftStage(eventResult: object)` returning `'analysis' | 'outline'`.

- [ ] **Step 1: Write failing helper tests**

```ts
import assert from 'node:assert/strict'
import {
  buildDraftAnalyzePayload,
  buildDraftAnalysisSections,
  filterDraftHistory,
  restoredDraftStage,
} from '../b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js'

const payload = buildDraftAnalyzePayload(`  - 美伊技术层级会谈启动\n背景材料 https://example.com/a\n重点关注涉我风险`)
assert.equal(payload.title, '美伊技术层级会谈启动')
assert.equal(payload.materials.includes('重点关注涉我风险'), true)
assert.deepEqual(payload.links, ['https://example.com/a'])
assert.equal(payload.category, '')
assert.equal(payload.region, '')

assert.throws(() => buildDraftAnalyzePayload('   '), /请输入编报主体/)
assert.equal(buildDraftAnalysisSections({ analysis: {} }).length, 5)
assert.deepEqual(buildDraftAnalysisSections({ analysis: {} }).map((item) => item.key), [
  'summary', 'actors', 'timeAndPlace', 'facts', 'risk',
])
assert.deepEqual(filterDraftHistory([{ title: '美伊会谈' }, { title: '欧盟政策' }], '美伊').map((item) => item.title), ['美伊会谈'])
assert.equal(restoredDraftStage({ latestOutline: null }), 'analysis')
assert.equal(restoredDraftStage({ latestOutline: { outlineId: 'o1' } }), 'outline')
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx tsx tests/frontend-draft-simplified-flow.test.ts`

Expected: FAIL with `Cannot find module .../draftAssistantFlow.js`.

- [ ] **Step 3: Implement the helper module**

```js
function cleanTitleLine(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function extractHttpUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>'"，。；]+/gi) || []
  return Array.from(new Set(matches.map((item) => {
    try { return new URL(item).toString() } catch { return '' }
  }).filter(Boolean)))
}

export function buildDraftAnalyzePayload(sourceInput) {
  const materials = String(sourceInput || '').trim()
  if (!materials) throw new Error('请输入编报主体和相关材料')
  const firstLine = materials.split(/\r?\n/).map(cleanTitleLine).find(Boolean)
  return {
    title: firstLine || '未命名编报',
    materials,
    links: extractHttpUrls(materials),
    category: '',
    region: '',
  }
}

export function buildDraftAnalysisSections(eventResult = {}) {
  const analysis = eventResult.analysis || eventResult.event?.analysis || {}
  const event = eventResult.event || {}
  const text = (...values) => values.find((value) => String(value || '').trim()) || '暂无明确内容'
  const list = (value) => Array.isArray(value) ? value.filter(Boolean).join('\n') : text(value)
  return [
    { key: 'summary', title: '事件概括', content: text(analysis.oneSentenceSummary, analysis.summary, event.summary) },
    { key: 'actors', title: '核心主体', content: list(analysis.coreActors || analysis.actors || event.actors) },
    { key: 'timeAndPlace', title: '时间与地点', content: text(analysis.timeAndPlace, analysis.timelineSummary, analysis.location) },
    { key: 'facts', title: '关键事实', content: list(analysis.mainFacts || event.basicFacts) },
    { key: 'risk', title: '涉我风险', content: text(analysis.riskSummary, analysis.riskToUs, analysis.risks) },
  ]
}

export function filterDraftHistory(events = [], query = '') {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return events
  return events.filter((item) => `${item.title || ''} ${item.summary || ''}`.toLowerCase().includes(needle))
}

export function restoredDraftStage(eventResult = {}) {
  return eventResult.latestOutline?.outlineId ? 'outline' : 'analysis'
}
```

- [ ] **Step 4: Run the helper test**

Run: `npx tsx tests/frontend-draft-simplified-flow.test.ts`

Expected: PASS and a final `frontend draft simplified flow tests passed` log added to the test.

- [ ] **Step 5: Commit the helper slice**

```bash
git add b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js tests/frontend-draft-simplified-flow.test.ts
git commit -m "feat: add simplified draft flow helpers"
```

---

### Task 2: Serialized Autosave Queue

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/draftAutosave.js`
- Modify: `tests/frontend-draft-simplified-flow.test.ts`

**Interfaces:**
- Produces: `createDraftAutosave({ save, onState, delay, scheduleTimer, cancelTimer })`.
- Queue methods: `schedule(snapshot)`, `flush()`, `retry()`, `dispose()`.
- Queue states: `'idle' | 'dirty' | 'saving' | 'saved' | 'error'`.

- [ ] **Step 1: Add a failing queue test with injected timers**

```ts
const callbacks: Array<() => void> = []
const states: string[] = []
const saved: string[] = []
const queue = createDraftAutosave({
  save: async (snapshot) => { saved.push(snapshot) },
  onState: (state) => states.push(state),
  delay: 10,
  scheduleTimer: (callback) => { callbacks.push(callback); return callbacks.length - 1 },
  cancelTimer: () => undefined,
})
queue.schedule('first')
queue.schedule('latest')
await callbacks.at(-1)?.()
await queue.flush()
assert.deepEqual(saved, ['latest'])
assert.equal(states.includes('dirty'), true)
assert.equal(states.at(-1), 'saved')
```

- [ ] **Step 2: Run the test and verify `createDraftAutosave` is missing**

Run: `npx tsx tests/frontend-draft-simplified-flow.test.ts`

Expected: FAIL with an export/import error for `createDraftAutosave`.

- [ ] **Step 3: Implement the queue**

```js
export function createDraftAutosave({
  save,
  onState = () => {},
  delay = 1200,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  let timer = null
  let pending = null
  let failed = null
  let running = null
  let disposed = false

  const setState = (state, error = null) => onState(state, error)
  const drain = async () => {
    if (disposed || running || pending == null) return running
    const snapshot = pending
    pending = null
    setState('saving')
    running = Promise.resolve(save(snapshot))
      .then(() => {
        failed = null
        setState(pending == null ? 'saved' : 'dirty')
      })
      .catch((error) => {
        failed = snapshot
        setState('error', error)
        throw error
      })
      .finally(() => { running = null })
    await running
    if (pending != null) return drain()
  }
  const arm = () => {
    if (timer != null) cancelTimer(timer)
    timer = scheduleTimer(() => { timer = null; return drain() }, delay)
  }
  return {
    schedule(snapshot) { pending = snapshot; failed = null; setState('dirty'); arm() },
    async flush() { if (timer != null) cancelTimer(timer); timer = null; await drain() },
    async retry() { if (failed != null) { pending = failed; failed = null }; await drain() },
    dispose() { disposed = true; if (timer != null) cancelTimer(timer); timer = null },
  }
}
```

- [ ] **Step 4: Add and pass failure/retry and serialized-request tests**

Run: `npx tsx tests/frontend-draft-simplified-flow.test.ts`

Expected: PASS; assertions prove failed snapshots survive and a second snapshot waits for the first request.

- [ ] **Step 5: Commit the autosave slice**

```bash
git add b_k3ewYvsOEc1/src/lib/draftAutosave.js tests/frontend-draft-simplified-flow.test.ts
git commit -m "feat: serialize draft outline autosave"
```

---

### Task 3: Source Composer, Analysis View, and History Drawer

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue`
- Create: `b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue`
- Modify: `b_k3ewYvsOEc1/package.json`
- Modify: `b_k3ewYvsOEc1/pnpm-lock.yaml`
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `tests/frontend-auto-resize-textarea.test.ts`

**Interfaces:**
- `DraftSourceComposer` props: `modelValue`, `loading`, `error`; emits `update:modelValue`, `submit`.
- `DraftAnalysisView` props: `sourceInput`, `sections`, `loading`; emits `back`, `generate`, `retry`.
- `DraftHistorySidebar` props: `open`, `currentEventId`, `events`, `loading`; emits `close`, `select-event`, `create-event`.

- [ ] **Step 1: Replace legacy source assertions with failing simplified contracts**

```ts
assert.match(assistantSource, /<DraftSourceComposer/)
assert.match(assistantSource, /<DraftAnalysisView/)
assert.match(assistantSource, /<DraftHistorySidebar/)
assert.doesNotMatch(assistantSource, /<DraftStepNavigation/)
assert.doesNotMatch(assistantSource, /<DraftContextPanel/)
assert.doesNotMatch(assistantSource, /<EventSourcePanel/)
assert.doesNotMatch(assistantSource, /<EventPreviewPanel/)
assert.match(sourceComposer, /<AutoResizeTextarea/)
assert.doesNotMatch(sourceComposer, /事件分类|地区选择|信息完整度|最近草稿/)
assert.match(historySource, /role="dialog"/)
assert.match(historySource, /搜索历史编报/)
assert.doesNotMatch(historySource, /删除/)
```

- [ ] **Step 2: Run tests and verify missing-component failures**

Run: `npx tsx tests/frontend-draft-workbench.test.ts && npx tsx tests/frontend-auto-resize-textarea.test.ts`

Expected: FAIL because the new component files and imports do not exist.

- [ ] **Step 3: Add icons and build the three components**

Run: `cd b_k3ewYvsOEc1 && pnpm add lucide-vue-next`

Use `History`, `Search`, `SquarePen`, `PanelLeftClose`, `ArrowUp`, `ArrowLeft`, and `ListTree` from `lucide-vue-next`. Use an autosizing source composer with a stable `min-height: 152px`, an analysis stream with five unframed sections, and a fixed overlay history drawer with a 260px desktop width.

The history list item contract is:

```vue
<button
  v-for="item in filteredEvents"
  :key="item.eventId"
  class="draft-history-row"
  :class="{ active: item.eventId === currentEventId }"
  type="button"
  @click="emit('select-event', item.eventId)"
>
  <span>{{ item.title || '未命名编报' }}</span>
  <time>{{ formatHistoryTime(item.updatedAt || item.createdAt) }}</time>
</button>
```

- [ ] **Step 4: Run component source tests and the frontend build**

Run: `npx tsx tests/frontend-draft-workbench.test.ts && npx tsx tests/frontend-auto-resize-textarea.test.ts && cd b_k3ewYvsOEc1 && pnpm run build`

Expected: all tests PASS and Vite exits 0.

- [ ] **Step 5: Commit the conversational shell**

```bash
git add b_k3ewYvsOEc1/package.json b_k3ewYvsOEc1/pnpm-lock.yaml b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue tests/frontend-draft-workbench.test.ts tests/frontend-auto-resize-textarea.test.ts
git commit -m "feat: add chat-style draft entry and history"
```

---

### Task 4: Direct Outline Editor and Read-Only Confirmation

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftOutlineView.vue`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- `DraftOutlineEditor` props: `modelValue`, `saveStatus`, `saveError`, `feedback`, `revising`.
- Emits: `update:modelValue`, `update:feedback`, `revise`, `retry-save`, `confirm`.
- `DraftOutlineView` consumes `outline` and emits no edit action.

- [ ] **Step 1: Add failing editor/confirmation source contracts**

```ts
assert.match(outlineEditorSource, /update:modelValue/)
assert.match(outlineEditorSource, /已自动保存|保存中|保存失败|未保存/)
assert.match(outlineEditorSource, /AI 修改/)
assert.match(outlineEditorSource, /<AutoResizeTextarea/)
assert.doesNotMatch(outlineEditorSource, /V\d|版本记录|恢复旧版本|版本比较/)
assert.doesNotMatch(outlineViewSource, /emit\('edit'\)|编辑提纲|更多提纲操作/)
```

- [ ] **Step 2: Run and verify failures against the legacy outline view**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL on missing `DraftOutlineEditor.vue` and legacy edit controls.

- [ ] **Step 3: Implement recursive two-level editing**

Use controlled immutable updates so every change emits a cloned complete outline:

```js
function patchRoot(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function patchSection(index, patch) {
  const outlineItems = cloneItems(props.modelValue.outlineItems)
  outlineItems[index] = { ...outlineItems[index], ...patch }
  emit('update:modelValue', { ...props.modelValue, outlineItems })
}

function patchChild(sectionIndex, childIndex, patch) {
  const outlineItems = cloneItems(props.modelValue.outlineItems)
  outlineItems[sectionIndex].children[childIndex] = {
    ...outlineItems[sectionIndex].children[childIndex],
    ...patch,
  }
  emit('update:modelValue', { ...props.modelValue, outlineItems })
}
```

Keep add, duplicate, reorder, and delete actions only for outline sections and children. Use icon buttons with accessible labels and tooltips. Remove edit notes, preview mode, source requirements, writing-focus tabs, and uncertainty/version panels from visible UI.

- [ ] **Step 4: Make `DraftOutlineView` strictly read-only and run tests**

Run: `npx tsx tests/frontend-draft-workbench.test.ts && cd b_k3ewYvsOEc1 && pnpm run build`

Expected: PASS and no Vue compiler warnings.

- [ ] **Step 5: Commit the outline slice**

```bash
git add b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue b_k3ewYvsOEc1/src/components/DraftOutlineView.vue tests/frontend-draft-workbench.test.ts
git commit -m "feat: simplify current draft outline editing"
```

---

### Task 5: Workflow Orchestration, Autosave, and Automatic Handoff

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DraftImportState.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Modify: `b_k3ewYvsOEc1/src/lib/draftWorkbench.js`
- Modify: `tests/frontend-draft-simplified-flow.test.ts`
- Modify: `tests/frontend-draft-workbench.test.ts`

**Interfaces:**
- `DraftAssistant.vue` remains compatible with `currentUser`, `initialEventId`, `back`, `request-login`, and `report-job-created`.
- Existing API functions remain unchanged.

- [ ] **Step 1: Add failing orchestration assertions**

```ts
assert.doesNotMatch(assistantSource, /getDraftEventOutlines|getDraftOutline|outlineVersions|versionLabel/)
assert.match(assistantSource, /buildDraftAnalyzePayload\(sourceInput\.value\)/)
assert.match(assistantSource, /createDraftAutosave/)
assert.match(assistantSource, /await autosave\.flush\(\)/)
assert.match(assistantSource, /await importDraftOutline/)
assert.match(assistantSource, /await createReportJob/)
assert.match(assistantSource, /emit\('report-job-created'/)
assert.doesNotMatch(assistantSource, /导入配置|确认当前提纲版本|保存为新版本/)
```

- [ ] **Step 2: Run and verify failures against the legacy orchestrator**

Run: `npx tsx tests/frontend-draft-workbench.test.ts`

Expected: FAIL on legacy version imports and absent simplified helpers.

- [ ] **Step 3: Rewrite `DraftAssistant.vue` as the stage coordinator**

Core state:

```js
const stage = ref('input')
const sourceInput = ref('')
const eventResult = ref(null)
const selectedOutline = ref(null)
const outlineDraft = ref(emptyOutline())
const saveStatus = ref('idle')
const saveError = ref('')
const historyOpen = ref(false)
const importState = reactive({ status: 'idle', error: '', job: null })
```

Local helpers used by the coordinator:

```js
function emptyOutline() {
  return {
    reportTitle: '',
    reportTheme: '',
    coreArgument: '',
    outlineItems: [],
  }
}

function cloneOutline(value = {}) {
  return JSON.parse(JSON.stringify({ ...emptyOutline(), ...value }))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || '操作失败')
}

let syncingOutline = false
function syncOutlineDraft(value) {
  syncingOutline = true
  outlineDraft.value = cloneOutline(value)
  queueMicrotask(() => { syncingOutline = false })
}

async function flushBeforeLeaving() {
  try {
    await autosave.flush()
    return saveStatus.value !== 'error'
  } catch {
    return false
  }
}

function buildDraftReportPayload(imported, reportTitle) {
  const knownContext = {
    kind: 'draft_assistant_import',
    topic: reportTitle,
    reportType: 'K报',
    draftAssistantMode: true,
    eventId: imported.eventId,
    outlineId: imported.outlineId,
    planId: imported.planId,
    databaseSourceOptions: {
      enabled: true,
      lookbackDays: 30,
      maxMetadataRows: 50,
      maxContentRows: 8,
    },
  }
  return {
    skill: 'write-hb',
    payload: {
      title: reportTitle,
      topic: reportTitle,
      report_type: 'K报',
      eventId: imported.eventId,
      outlineId: imported.outlineId,
      planId: imported.planId,
      draftAssistantMode: true,
      deepReportEnabled: true,
      known_context: JSON.stringify(knownContext, null, 2),
      language: 'zh-CN',
    },
  }
}
```

Analyze and restore flow:

```js
async function startDraft() {
  const payload = buildDraftAnalyzePayload(sourceInput.value)
  stage.value = 'analysis'
  isAnalyzing.value = true
  try {
    eventResult.value = await analyzeDraftEvent(payload)
    await loadEvents()
  } catch (error) {
    analysisError.value = messageOf(error)
  } finally {
    isAnalyzing.value = false
  }
}

async function openEvent(eventId) {
  if (!(await flushBeforeLeaving())) return
  const result = await getDraftEvent(eventId)
  eventResult.value = result
  sourceInput.value = result.event?.rawInput?.materials || result.event?.summary || result.event?.title || ''
  selectedOutline.value = result.latestOutline || null
  if (selectedOutline.value) syncOutlineDraft(selectedOutline.value.outline)
  stage.value = restoredDraftStage(result)
  historyOpen.value = false
}
```

Autosave callback:

```js
const autosave = createDraftAutosave({
  save: async (snapshot) => {
    const saved = await manualUpdateDraftOutline({
      outlineId: selectedOutline.value.outlineId,
      outline: snapshot,
      editNote: '',
    })
    selectedOutline.value = saved
  },
  onState: (status, error) => {
    saveStatus.value = status
    saveError.value = error ? messageOf(error) : ''
  },
})
```

Before AI revision, confirmation, history switching, or component unmount, call `autosave.flush()`. Catch failures and keep the current stage. Watch `outlineDraft` deeply only while `stage === 'outline'` and suppress scheduling while syncing server responses.

- [ ] **Step 4: Automate import and deep-report creation**

```js
async function importToDeepReport() {
  importState.status = 'creating'
  stage.value = 'importing'
  try {
    const imported = await importDraftOutline({ outlineId: selectedOutline.value.outlineId })
    const reportTitle = imported.plan?.reportTitle || outlineDraft.value.reportTitle
    const created = await createReportJob(buildDraftReportPayload(imported, reportTitle))
    importState.status = 'completed'
    importState.job = created
    stage.value = 'completed'
    emit('report-job-created', { ...created, payload: { topic: reportTitle, report_type: 'K报' } })
  } catch (error) {
    importState.status = 'error'
    importState.error = messageOf(error)
  }
}
```

`DraftImportState` renders creating, error/retry, and redirecting copy without configuration controls.

- [ ] **Step 5: Run all draft tests and build**

Run:

```bash
npx tsx tests/frontend-draft-simplified-flow.test.ts
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-auto-resize-textarea.test.ts
cd b_k3ewYvsOEc1 && pnpm run build
```

Expected: every command exits 0.

- [ ] **Step 6: Commit the integrated workflow**

```bash
git add b_k3ewYvsOEc1/src/components/DraftAssistant.vue b_k3ewYvsOEc1/src/components/DraftImportState.vue b_k3ewYvsOEc1/src/lib/draftWorkbench.js tests/frontend-draft-simplified-flow.test.ts tests/frontend-draft-workbench.test.ts
git commit -m "feat: complete simplified draft assistant workflow"
```

---

### Task 6: Browser Verification and Visual Corrections

**Files:**
- Inspect: `b_k3ewYvsOEc1/src/components/DraftAssistant.vue`
- Inspect: `b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue`
- Inspect: `b_k3ewYvsOEc1/src/components/DraftAnalysisView.vue`
- Inspect: `b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue`
- Inspect: `b_k3ewYvsOEc1/src/components/DraftHistorySidebar.vue`
- Inspect: `b_k3ewYvsOEc1/src/components/DraftImportState.vue`
- Modify: only the inspected component whose rendered defect is recorded in Steps 2-4

**Interfaces:** None. This task validates the complete user-facing workflow.

- [ ] **Step 1: Start the frontend and backend development servers**

Run backend: `npm run dev`

Run frontend in another session: `cd b_k3ewYvsOEc1 && pnpm run dev -- --host 127.0.0.1`

Expected: both servers remain running and Vite prints a local URL.

- [ ] **Step 2: Verify desktop input and history behavior at 1440x900**

Check:

- The input stage has one composer, no history, no stepper, and no legacy fields.
- Submitting empty content shows inline validation without layout shift.
- After analysis begins, the history button appears but the drawer is closed.
- Opening the drawer overlays the content at approximately 260px without shrinking the editor.
- Current history rows use a neutral light-gray selected state.

- [ ] **Step 3: Verify analysis, outline, confirmation, and import states**

Use an existing historical event if live AI generation is slow. Check exactly five analysis sections; direct outline fields; AI feedback composer; save-state transitions; no version strings; read-only confirmation; and retryable import failure/success state.

- [ ] **Step 4: Verify mobile layout at 390x844**

Check:

- No horizontal overflow.
- Composer text and submit action do not overlap.
- Outline field labels and actions wrap cleanly.
- The history drawer leaves 12px viewport margins and its close button remains visible.
- Fixed or sticky controls do not cover confirmation/import actions.

- [ ] **Step 5: Apply only evidence-based visual fixes and rerun verification**

After each correction, reload the local page and repeat the failing viewport check. Do not add decorative sections or new product behavior during QA.

- [ ] **Step 6: Run final automated verification**

```bash
npx tsx tests/frontend-draft-simplified-flow.test.ts
npx tsx tests/frontend-draft-workbench.test.ts
npx tsx tests/frontend-auto-resize-textarea.test.ts
cd b_k3ewYvsOEc1 && pnpm run build
```

Expected: all tests PASS and Vite build exits 0.

- [ ] **Step 7: Commit final visual corrections**

```bash
git add b_k3ewYvsOEc1/src/components b_k3ewYvsOEc1/src/lib tests/frontend-draft-simplified-flow.test.ts tests/frontend-draft-workbench.test.ts tests/frontend-auto-resize-textarea.test.ts
git commit -m "fix: polish simplified draft assistant layout"
```
