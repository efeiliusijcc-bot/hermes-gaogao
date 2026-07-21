# Hide Existing K-Report Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete K-report history UI while excluding only records created at or before `2026-07-21T01:42:40Z`.

**Architecture:** The frontend supplies an optional `createdAfter` query parameter on recent and full history requests. The backend validates the timestamp and filters authorized jobs before totals, status counts, sorting, and pagination. Clearing the production cutoff restores every stored record without data changes.

**Tech Stack:** Vue 3, Vite, NestJS, TypeScript, Node test runner

## Global Constraints

- Do not delete or update stored report records.
- Do not change report generation, persistence, export, permissions, QA history, or Daily Awareness history.
- Keep all report-history navigation and management controls visible.
- Invalid or absent cutoff values must return the existing authorized history.

---

### Task 1: Backend History Cutoff

**Files:**
- Modify: `server/reports.service.ts`
- Modify: `server/reports.controller.ts`
- Test: `tests/report-history-created-after.test.ts`

**Interfaces:**
- Consumes: `ReportsService.listJobs(options, user)`
- Produces: `JobListOptions.createdAfter?: string` and controller query `createdAfter`

- [ ] **Step 1: Write the failing service test**

Create jobs before, exactly at, and after the cutoff. Assert only the later job contributes to `items`, `total`, `totalPages`, and `statusCounts`; assert missing and invalid cutoffs keep all authorized jobs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/report-history-created-after.test.ts`

Expected: FAIL because `createdAfter` is not part of `JobListOptions` and does not filter jobs.

- [ ] **Step 3: Implement minimal backend filtering**

Add `createdAfter?: string` to `JobListOptions`. Parse it once with `Date.parse`; use no cutoff when parsing is not finite. Apply `new Date(job.createdAt).getTime() > cutoff` before sorting and pagination. Forward `@Query('createdAfter')` from the controller.

- [ ] **Step 4: Run the focused backend test**

Run: `npx tsx --test tests/report-history-created-after.test.ts`

Expected: PASS.

### Task 2: Restore UI and Supply Cutoff

**Files:**
- Replace: `b_k3ewYvsOEc1/src/lib/reportHistoryVisibility.js` with `b_k3ewYvsOEc1/src/lib/reportHistoryCutoff.js`
- Modify: `b_k3ewYvsOEc1/src/composables/useReportJobs.js`
- Modify: `b_k3ewYvsOEc1/src/App.vue`
- Modify: `b_k3ewYvsOEc1/src/components/ControlPanel.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Modify: `b_k3ewYvsOEc1/.env.production`
- Replace: `tests/frontend-report-history-visibility.test.ts` with `tests/frontend-report-history-cutoff.test.ts`

**Interfaces:**
- Produces: `REPORT_HISTORY_CREATED_AFTER: string`
- Consumes: `fetchReportJobs({ createdAfter })`

- [ ] **Step 1: Write the failing frontend contract test**

Assert the production cutoff equals `2026-07-21T01:42:40Z`, both recent and complete list requests send `createdAfter`, and no history UI is guarded by a visibility boolean.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/frontend-report-history-cutoff.test.ts`

Expected: FAIL because the current implementation hides the complete UI and does not send a cutoff.

- [ ] **Step 3: Implement the minimal frontend correction**

Read `VITE_REPORT_HISTORY_CREATED_AFTER`, pass it to both `fetchReportJobs` calls, remove the `reportHistoryVisible` prop and guards, and restore the archive/list route behavior. Set the production value to the agreed ISO timestamp.

- [ ] **Step 4: Run focused frontend tests**

Run: `npx tsx --test tests/frontend-report-history-cutoff.test.ts tests/frontend-history-sidebar.test.ts`

Expected: cutoff test passes; any unrelated stale assertion in the sidebar test is documented rather than changed outside scope.

### Task 3: Verification and Deployment

**Files:**
- Verify all modified files

**Interfaces:**
- Consumes: frontend production bundle and deployed API
- Produces: deployed history UI with old records filtered and future records visible

- [ ] **Step 1: Run focused regression tests**

Run: `npx tsx --test tests/report-history-created-after.test.ts tests/frontend-report-history-cutoff.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run builds and whitespace validation**

Run: `npm run build`, `npm --prefix b_k3ewYvsOEc1 run build`, and `git diff --check`.

Expected: all commands exit 0.

- [ ] **Step 3: Commit, push, and deploy**

Commit only the cutoff correction, push `main`, deploy the backend and frontend using the repository's established deployment scripts.

- [ ] **Step 4: Verify production behavior**

Confirm the report-history sidebar and full list are visible, existing records are absent, history navigation works, and the report creation form remains available. Confirm QA and Daily Awareness histories remain unchanged.
