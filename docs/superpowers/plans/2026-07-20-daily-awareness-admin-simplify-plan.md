# Dynamic Awareness Admin Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical daily-awareness admin tabs with a simple three-page workspace: today’s brief, issues needing attention, and daily history.

**Architecture:** Keep the existing NestJS contracts and add only read-only count/timestamp fields to the admin status and successful-history responses. A small frontend view-model module translates backend enums into business language and merges run/history data by business date. `DailyAwarenessAdmin.vue` owns loading and actions while the pure view-model functions own display labels, summary states, issue rows, and history rows. `UserManagement.vue` and `App.vue` receive one navigation event so “查看简报” opens the existing read-only daily-awareness workspace.

**Tech Stack:** Vue 3 `<script setup>`, existing `b_k3ewYvsOEc1/src/lib/api.js` request helpers, Node `node:test` with `tsx`, Vite build.

## Global Constraints

- Keep the 06:00 schedule, previous-day MySQL source, model scoring, and 50-item selection unchanged.
- Do not add database tables or change the internal event contract.
- Keep administrator authorization on `system:daily-awareness:manage`; keep the read-only workspace on `daily-awareness:view`.
- Technical enums and IDs remain available only in expanded detail views; they must not be default user-facing labels.
- A successful global brief must never be implicitly overwritten by Inbox reprocessing.
- Every production behavior change starts with a failing test and is verified with the focused frontend tests, the full daily-awareness test set, and both builds.

---

### Task 1: Add the daily-awareness admin view model

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/dailyAwarenessAdminView.js`
- Create: `tests/daily-awareness-admin-view.test.ts`

**Interfaces:**
- Consumes: admin status objects, admin run objects, Inbox objects, and successful history summaries.
- Produces: `dailyAwarenessStatusLabel(status)`, `dailyAwarenessIssueLabel(item)`, `buildTodaySummary(status)`, and `mergeDailyAwarenessHistory(runs, historyItems)`.

- [ ] **Step 1: Write failing tests for business-language mapping and daily merging.**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTodaySummary,
  dailyAwarenessIssueLabel,
  dailyAwarenessStatusLabel,
  mergeDailyAwarenessHistory,
} from '../b_k3ewYvsOEc1/src/lib/dailyAwarenessAdminView.js';

test('maps successful status to a readable today summary with actual event count', () => {
  assert.deepEqual(
    buildTodaySummary({
      business_date: '2026-07-20',
      data_status: 'READY',
      generation_status: 'SUCCESS',
      source_business_date: '2026-07-19',
      selected_count: 2,
      generated_at: '2026-07-20T06:43:00.000Z',
    }),
    {
      label: '今日简报已生成',
      tone: 'success',
      businessDate: '2026-07-20',
      sourceBusinessDate: '2026-07-19',
      selectedCount: 2,
      generatedAt: '2026-07-20T06:43:00.000Z',
      action: 'view',
    },
  );
});

test('maps Inbox states without exposing technical enum labels', () => {
  assert.equal(dailyAwarenessIssueLabel({ status: 'DEAD_LETTER' }).label, '需要人工处理');
  assert.equal(dailyAwarenessIssueLabel({ status: 'RETRY_PENDING' }).label, '正在自动恢复');
  assert.equal(dailyAwarenessIssueLabel({ status: 'PROCESSING' }).label, '正在生成');
});

test('merges successful history and latest run into one row per business date', () => {
  const rows = mergeDailyAwarenessHistory(
    [
      { businessDate: '2026-07-19', status: 'FAILED', sourceBusinessDate: '2026-07-18', createdAt: '2026-07-19T06:00:00Z', errorMessage: 'failed' },
      { businessDate: '2026-07-19', status: 'SUCCESS', sourceBusinessDate: '2026-07-18', sourceCount: 7283, finishedAt: '2026-07-20T00:43:00Z' },
    ],
    [{ businessDate: '2026-07-19', sourceBusinessDate: '2026-07-18', selectedCount: 50, generatedAt: '2026-07-20T00:43:00Z' }],
  );
  assert.deepEqual(rows, [{
    businessDate: '2026-07-19',
    resultLabel: '补生成成功',
    tone: 'success',
    sourceBusinessDate: '2026-07-18',
    selectedCount: 50,
    completedAt: '2026-07-20T00:43:00Z',
    action: 'view',
    latestRun: rows[0].latestRun,
  }]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the view-model module is missing.**

Run: `npx tsx --test tests/daily-awareness-admin-view.test.ts`

Expected: FAIL with a module-not-found error for `b_k3ewYvsOEc1/src/lib/dailyAwarenessAdminView.js`.

- [ ] **Step 3: Implement the minimal pure view-model module.**

Implement these rules in `dailyAwarenessAdminView.js`:

```js
const STATUS_LABELS = {
  RECEIVED: { label: '即将开始', tone: 'neutral' },
  PROCESSING: { label: '正在生成', tone: 'info' },
  RETRY_PENDING: { label: '正在自动恢复', tone: 'warning' },
  DEAD_LETTER: { label: '需要人工处理', tone: 'danger' },
  PROCESSED: { label: '已解决', tone: 'success' },
};

export function dailyAwarenessStatusLabel(value) {
  return STATUS_LABELS[String(value || '').toUpperCase()] || { label: '状态未知', tone: 'neutral' };
}

export function dailyAwarenessIssueLabel(item = {}) {
  const mapped = dailyAwarenessStatusLabel(item.status);
  return { ...mapped, action: item.status === 'DEAD_LETTER' ? 'reprocess' : 'inspect' };
}
```

`buildTodaySummary` must read the additive admin status fields `selected_count` and `generated_at`, map `SUCCESS`, `GENERATING`, `NOT_REQUIRED`, `GENERATION_FAILED`, and `WAITING` to Chinese labels, and return an `action` of `view`, `issues`, or `refresh`. `mergeDailyAwarenessHistory` must group by `businessDate`, choose the latest run by `createdAt`, prefer a successful history item when one exists, and return one row per day with `resultLabel`, `tone`, source date, count, completion time, and action.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run: `npx tsx --test tests/daily-awareness-admin-view.test.ts`

Expected: all focused view-model tests pass.

- [ ] **Step 5: Commit the isolated view-model change.**

```bash
git add b_k3ewYvsOEc1/src/lib/dailyAwarenessAdminView.js tests/daily-awareness-admin-view.test.ts
git commit -m "feat: add daily awareness admin view model"
```

### Task 2: Expose read-only result summaries to the admin workspace

**Files:**
- Modify: `server/daily-awareness-admin.service.ts`
- Modify: `server/daily-awareness-query.service.ts`
- Modify: `tests/daily-awareness-admin.test.ts`
- Modify: `tests/daily-awareness-query.test.ts`

**Interfaces:**
- Consumes: existing `daily_briefs.selected_count` and `daily_briefs.generated_at` values.
- Produces: additive `selected_count` and `generated_at` fields on admin status, plus `selectedCount: number` on every item returned by `DailyAwarenessQueryService.history()`.

- [ ] **Step 1: Write a failing history response test.**

Add `selected_count: 50` to the `brief()` fixture. Assert:

```ts
test('history exposes the actual selected item count', async () => {
  const item = brief('brief-today', '2026-07-20');
  item.selected_count = 50;
  const service = serviceFor(null, [item]);

  const result = await service.history({ page: 1, pageSize: 20 });

  assert.equal(result.items[0]?.selectedCount, 50);
});
```

Also extend `admin status joins the latest run source and Inbox retry timing` to assert that the SQL joins `daily_briefs brief` through `day.current_brief_id` and that the returned row contains `selected_count: 50` and `generated_at`.

- [ ] **Step 2: Run the admin/query tests and verify the new assertions fail.**

Run: `npx tsx --test tests/daily-awareness-admin.test.ts tests/daily-awareness-query.test.ts`

Expected: FAIL because admin status does not join the current brief and `briefSummary()` does not yet return `selectedCount`.

- [ ] **Step 3: Add the read-only status and history fields.**

Extend the admin status query with:

```sql
LEFT JOIN daily_briefs brief ON brief.brief_id = day.current_brief_id
```

and select:

```sql
brief.selected_count, brief.generated_at
```

Add this property to `briefSummary()`:

```ts
selectedCount: Number(row.selected_count || 0),
```

Do not change SQL, migrations, or any write path because `SELECT * FROM daily_briefs` already supplies the value.

- [ ] **Step 4: Run the query test and verify it passes.**

Run: `npx tsx --test tests/daily-awareness-admin.test.ts tests/daily-awareness-query.test.ts`

Expected: all daily-awareness query tests pass.

- [ ] **Step 5: Commit the additive response field.**

```bash
git add server/daily-awareness-admin.service.ts server/daily-awareness-query.service.ts tests/daily-awareness-admin.test.ts tests/daily-awareness-query.test.ts
git commit -m "feat: expose daily brief selected count"
```

### Task 3: Rebuild the admin data loading and action state

**Files:**
- Modify: `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`

**Interfaces:**
- Consumes: Task 1 view-model exports, Task 2 admin status/history fields, and existing `getDailyAwarenessAdmin*`, `getDailyAwarenessHistory`, `regenerateDailyAwareness`, and `reprocessDailyAwarenessInbox` helpers.
- Produces: component state for `todaySummary`, `historyRows`, `issueRows`, `settingsOpen`, `detailsOpen`, loading guards, and readable error/notice messages.

- [ ] **Step 1: Add failing source assertions for the three business tabs and hidden technical defaults.**

Extend `tests/frontend-daily-awareness-v2.test.ts` with assertions that `DailyAwarenessAdmin.vue` contains `今日简报`, `异常处理`, `历史记录`, `需要人工处理`, `正在自动恢复`, and `查看技术详情`; assert that the default template does not render `运行状态与配置`, `死信 Inbox`, `RETRY_PENDING`, or `DEAD_LETTER` as visible labels.

- [ ] **Step 2: Run the frontend source test and verify the new assertions fail against the current component.**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`

Expected: the new assertions fail because the current component still renders the technical tabs and labels.

- [ ] **Step 3: Replace the component script state with business-view loading.**

Keep the existing permission check and mutation helpers. Change `loadAll()` to fetch admin status/config, successful history, runs, and Inbox in parallel. Add `loadIssues()` that requests up to 100 Inbox items without a status filter, keeps only `DEAD_LETTER`, `RETRY_PENDING`, `PROCESSING`, and `RECEIVED`, and converts each item through `dailyAwarenessIssueLabel`. Add `loadHistory()` that fetches the last 30 days of successful history plus up to 100 recent runs, filters runs to the same date range, then calls `mergeDailyAwarenessHistory`. Keep `loading`, `savingConfig`, `regenerating`, and `reprocessingEventId` guards so each mutation can only be submitted once.

Use readable errors: `暂时无法获取动态感知状态，请点击重试。`, `配置已被其他管理员更新，请刷新后再提交。`, `同一业务日期正在处理，请稍后再试。`, and `事件已重新排队，系统正在处理。`.

- [ ] **Step 4: Implement the simplified settings drawer and manual regeneration dialog.**

Show only category checkboxes and a 1–50 daily count in the first layer. Keep `lookbackHours`, `maxRetryCount`, `retryIntervalSeconds`, and `summaryMaxChars` in a collapsed “高级设置” block so the existing PUT payload remains complete. Keep the existing reason and explicit overwrite confirmation for manual regeneration; do not change its endpoint or success-brief conflict behavior.

- [ ] **Step 5: Run the focused frontend tests and verify source behavior is green.**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts tests/daily-awareness-admin-view.test.ts`

Expected: all updated frontend source and view-model tests pass.

- [ ] **Step 6: Commit the data/state refactor.**

```bash
git add b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue tests/frontend-daily-awareness-v2.test.ts
git commit -m "feat: simplify daily awareness admin state"
```

### Task 4: Implement the three-page template and navigation

**Files:**
- Modify: `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`
- Modify: `b_k3ewYvsOEc1/src/components/UserManagement.vue`
- Modify: `b_k3ewYvsOEc1/src/App.vue`

**Interfaces:**
- Consumes: Task 3 component state and the existing `openDailyAwareness` app navigation function.
- Produces: three accessible tabs, a Today page, an Issues page, a History page, settings/details drawers, and a `open-daily-awareness` event path from admin to the read-only workspace.

- [ ] **Step 1: Write failing source assertions for page structure and navigation.**

Add tests asserting that `UserManagement.vue` declares/emits `open-daily-awareness`, `App.vue` listens for it, and the component includes the three page headings, empty states, `查看简报`, `查看处理办法`, `再次生成`, and `展开技术详情`.

- [ ] **Step 2: Run the source test and verify it fails.**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`

Expected: the new structure and event assertions fail against the old component.

- [ ] **Step 3: Build the Today page.**

Render a compact result band with business date, source date, actual selected count, generated time, and a single primary action. Render a one-line settings summary and a secondary regeneration action. When the summary action is `issues`, route to the issues tab; when it is `view`, emit `open-daily-awareness` with the business date.

- [ ] **Step 4: Build the Issues page.**

Render only unresolved rows with date, readable problem, translated state, next retry time when available, and action. `再次生成` appears only for `DEAD_LETTER`. Keep error details in a disclosure panel with event/run IDs, attempts, timestamps, original message, and error code.

- [ ] **Step 5: Build the History page.**

Render one compact row per business date with result, source date, selected count, completion time, and action. Use a date range selector defaulting to the last 30 days and a result selector. Put all run attempts and technical fields in a disclosure panel; never render an empty `--` table full of internal values.

- [ ] **Step 6: Add responsive styling and navigation wiring.**

Use the existing neutral admin palette, restrained borders, 8px-or-less radii, clear success/warning/danger tones, and `overflow-x: auto` only for dense history details. Add `defineEmits(['open-daily-awareness'])` to `DailyAwarenessAdmin.vue`, extend `UserManagement.vue` to forward the same event, and bind `@open-daily-awareness="openDailyAwareness"` in `App.vue` without changing permission checks.

- [ ] **Step 7: Run frontend tests and build.**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts tests/daily-awareness-admin-view.test.ts`

Run: `npm --prefix b_k3ewYvsOEc1 run build`

Expected: all frontend tests pass and Vite reports a successful production build.

- [ ] **Step 8: Commit the page implementation.**

```bash
git add b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue b_k3ewYvsOEc1/src/components/UserManagement.vue b_k3ewYvsOEc1/src/App.vue tests/frontend-daily-awareness-v2.test.ts
git commit -m "feat: rebuild daily awareness admin workspace"
```

### Task 5: Full verification and browser QA

**Files:**
- Modify: `tests/frontend-daily-awareness-v2.test.ts` only if verification exposes a missing stable assertion.
- Verify: `server/`, `b_k3ewYvsOEc1/`, and the deployed admin page.

**Interfaces:**
- Consumes: all changes from Tasks 1–4.
- Produces: verified desktop and narrow-screen behavior with no backend contract regressions.

- [ ] **Step 1: Run all daily-awareness tests and both builds.**

```bash
npx tsx --test tests/*daily-awareness*.test.ts
npm run build
npm --prefix b_k3ewYvsOEc1 run build
```

Expected: zero test failures and both TypeScript/Vite builds exit with status 0.

- [ ] **Step 2: Run `git diff --check` and inspect the final diff.**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the planned frontend, test, and documentation files are changed.

- [ ] **Step 3: Verify browser behavior at desktop and narrow widths.**

Open the management page with an admin session. Confirm the first screen shows Today’s brief, not technical configuration; click Issues and verify unresolved rows only; click History and verify one row per date; expand technical details; trigger refresh, reprocess, and manual regeneration guards; then repeat at a narrow viewport and confirm no overlapping text or clipped primary actions.

- [ ] **Step 4: Commit any test-only adjustments and report verification evidence.**

If a stable assertion needs adjustment, run its focused test first, then commit only the assertion change with `git add` and `git commit`. Do not change backend generation behavior during browser QA.
