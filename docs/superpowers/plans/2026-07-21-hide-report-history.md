# Temporary K-Report History Hiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide every AI 深度编报/K报 history entry behind one disabled-by-default frontend build flag while preserving report generation, persistence, current-task viewing, exports, QA history, and Daily Awareness history.

**Architecture:** A focused frontend helper owns the `VITE_REPORT_HISTORY_VISIBLE` interpretation. `App.vue` passes the resulting boolean to `ControlPanel.vue` and `DataCanvas.vue`, guards navigation into the archive view, and falls back to the generator if list state is reached while hidden. Backend services and `useReportJobs` remain unchanged so all reports continue to be generated and stored.

**Tech Stack:** Vue 3 Composition API, Vite environment variables, Node test runner through `tsx`, existing source-contract tests.

## Global Constraints

- Only AI 深度编报/K报 history is hidden; QA history and Daily Awareness history remain visible.
- `VITE_REPORT_HISTORY_VISIBLE` must equal the exact string `true` to reveal history; missing or any other value hides it.
- Do not modify report generation, polling, persistence, query APIs, database records, report files, permissions, deletion, or restoration services.
- Current and newly generated reports remain visible in the active workspace and retain Word/PDF export and new-report actions.
- Restoring history requires only setting `VITE_REPORT_HISTORY_VISIBLE=true` and rebuilding.

---

### Task 1: Central History Visibility Flag

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js`
- Modify: `b_k3ewYvsOEc1/.env.production`
- Create: `tests/frontend-report-history-visibility.test.ts`

**Interfaces:**
- Consumes: Vite build environment object containing optional `VITE_REPORT_HISTORY_VISIBLE`.
- Produces: `isReportHistoryVisible(env): boolean` and `REPORT_HISTORY_VISIBLE: boolean`.

- [ ] **Step 1: Write the failing flag tests**

Create `tests/frontend-report-history-visibility.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isReportHistoryVisible } from '../b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js';

const frontendRoot = new URL('../b_k3ewYvsOEc1/', import.meta.url);

async function frontendSource(relativePath: string) {
  return readFile(new URL(relativePath, frontendRoot), 'utf8');
}

test('report history is hidden unless the build flag is exactly true', () => {
  assert.equal(isReportHistoryVisible(undefined), false);
  assert.equal(isReportHistoryVisible({}), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'false' }), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'TRUE' }), false);
  assert.equal(isReportHistoryVisible({ VITE_REPORT_HISTORY_VISIBLE: 'true' }), true);
});

test('production frontend explicitly hides report history by default', async () => {
  const envSource = await frontendSource('.env.production');
  assert.match(envSource, /^VITE_REPORT_HISTORY_VISIBLE=false$/m);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/frontend-report-history-visibility.test.ts
```

Expected: FAIL because `reportHistoryVisibility.js` does not exist.

- [ ] **Step 3: Implement the flag helper and production default**

Create `b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js`:

```js
export function isReportHistoryVisible(env) {
  return env?.VITE_REPORT_HISTORY_VISIBLE === 'true'
}

export const REPORT_HISTORY_VISIBLE = isReportHistoryVisible(import.meta.env)
```

Append to `b_k3ewYvsOEc1/.env.production`:

```dotenv
VITE_REPORT_HISTORY_VISIBLE=false
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/frontend-report-history-visibility.test.ts
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the focused flag change**

```bash
git add b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js b_k3ewYvsOEc1/.env.production tests/frontend-report-history-visibility.test.ts
git commit -m "feat: add report history visibility flag"
```

---

### Task 2: Hide K-Report History Surfaces

**Files:**
- Modify: `b_k3ewYvsOEc1/src/App.vue`
- Modify: `b_k3ewYvsOEc1/src/components/ControlPanel.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Modify: `tests/frontend-report-history-visibility.test.ts`

**Interfaces:**
- Consumes: `REPORT_HISTORY_VISIBLE` from Task 1.
- Produces: Boolean Vue prop `reportHistoryVisible` in `ControlPanel.vue` and `DataCanvas.vue`.

- [ ] **Step 1: Extend the source-contract test and verify RED**

Append this test to `tests/frontend-report-history-visibility.test.ts`:

```ts
test('K-report history surfaces share the flag while unrelated histories remain available', async () => {
  const [appSource, controlSource, canvasSource, jobsSource, dailySource] = await Promise.all([
    frontendSource('src/App.vue'),
    frontendSource('src/components/ControlPanel.vue'),
    frontendSource('src/components/DataCanvas.vue'),
    frontendSource('src/composables/useReportJobs.js'),
    frontendSource('src/components/DailyAwareness.vue'),
  ]);

  assert.match(appSource, /import \{ REPORT_HISTORY_VISIBLE \} from '.\/lib\/reportHistoryVisibility\.js'/);
  assert.match(appSource, /const reportHistoryVisible = REPORT_HISTORY_VISIBLE/);
  assert.match(appSource, /:report-history-visible="reportHistoryVisible"/);
  assert.match(appSource, /currentView === 'generator' \|\| !reportHistoryVisible/);
  assert.match(appSource, /if \(!reportHistoryVisible\) return/);

  assert.match(controlSource, /reportHistoryVisible:\s*Boolean/);
  assert.match(controlSource, /v-if="isQaMode \|\| reportHistoryVisible"/);
  assert.match(controlSource, /问答历史/);

  assert.match(canvasSource, /reportHistoryVisible:\s*Boolean/);
  assert.equal((canvasSource.match(/v-if="reportHistoryVisible"[^>]*>\s*(?:<span>☷<\/span>\s*)?报告列表/g) || []).length, 2);

  assert.match(jobsSource, /fetchReportJobs/);
  assert.match(jobsSource, /createReportJob/);
  assert.match(dailySource, /历史简报/);
});
```

Run:

```bash
npx tsx --test tests/frontend-report-history-visibility.test.ts
```

Expected: the new test fails because the components do not yet consume the flag.

- [ ] **Step 2: Wire the centralized flag in `App.vue`**

Add the import and constant:

```js
import { REPORT_HISTORY_VISIBLE } from './lib/reportHistoryVisibility.js'

const reportHistoryVisible = REPORT_HISTORY_VISIBLE
```

Guard the list handler:

```js
function openReportHistoryList() {
  if (!reportHistoryVisible) return
  // Existing authorization and navigation body remains unchanged.
}
```

Pass the prop to both children:

```vue
<ControlPanel :report-history-visible="reportHistoryVisible" />
<DataCanvas :report-history-visible="reportHistoryVisible" />
```

Change the generator branch so an inaccessible list state falls back to the active workspace:

```vue
<div v-else-if="currentView === 'generator' || !reportHistoryVisible" class="app-body">
```

- [ ] **Step 3: Hide only the report-mode history section in `ControlPanel.vue`**

Add the prop:

```js
reportHistoryVisible: Boolean,
```

Guard the existing history section while preserving QA mode:

```vue
<section v-if="isQaMode || reportHistoryVisible" class="panel recent-card flex-1 min-h-0 flex flex-col">
```

Do not change the QA session list, QA counts, engine state, or report generation action.

- [ ] **Step 4: Hide both list buttons in `DataCanvas.vue`**

Add the prop:

```js
reportHistoryVisible: Boolean,
```

Change the generator toolbar button to:

```vue
<button v-if="reportHistoryVisible" @click="emit('list')" class="sci-btn text-[10px] px-3 py-2">报告列表</button>
```

Change the result toolbar button to:

```vue
<button v-if="reportHistoryVisible" @click="emit('list')" class="result-action-btn" type="button">
  <span>☷</span> 报告列表
</button>
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx tsx --test tests/frontend-report-history-visibility.test.ts
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 6: Run related frontend and report regressions**

Run:

```bash
npx tsx --test tests/frontend-*.test.ts tests/report-planning-context.test.ts tests/account-permissions.test.ts
npm --prefix b_k3ewYvsOEc1 run build
```

Expected: all tests pass and Vite exits 0. Existing server-side list, generation, persistence, ownership, delete, restore, QA, and Daily Awareness assertions remain unchanged.

- [ ] **Step 7: Commit the UI hiding change**

```bash
git add b_k3ewYvsOEc1/src/App.vue b_k3ewYvsOEc1/src/components/ControlPanel.vue b_k3ewYvsOEc1/src/components/DataCanvas.vue tests/frontend-report-history-visibility.test.ts
git commit -m "feat: hide K-report history surfaces"
```

---

### Task 3: Final Verification and Delivery

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: completed history flag and UI wiring.
- Produces: verified branch ready to merge and deploy.

- [ ] **Step 1: Run complete relevant verification**

```bash
npm run build
npx tsx --test tests/frontend-report-history-visibility.test.ts tests/frontend-*.test.ts tests/report-planning-context.test.ts tests/account-permissions.test.ts
npm --prefix b_k3ewYvsOEc1 run build
git diff --check
git status --short --branch
```

Expected: both builds exit 0, all tests pass, diff check is empty, and only committed branch changes remain.

- [ ] **Step 2: Browser QA on the deployed or authenticated preview**

Verify at desktop and narrow viewport:

1. Report mode contains no “编报历史”, recent report items, “查看全部报告”, “报告列表”, archive table, or trash navigation.
2. QA mode still shows “问答历史” and saved QA sessions.
3. Daily Awareness still exposes its historical brief view.
4. Starting a report, viewing the active task, opening the completed result, exporting Word/PDF, and selecting “新建编报” remain available.
5. No toolbar gaps, overlap, clipped actions, or empty sidebar frame appear.

- [ ] **Step 3: Merge and push after verification**

Merge `codex/hide-report-history` into `main`, re-run the focused test and frontend build on `main`, then push `main` to `origin`.
