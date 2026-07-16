# Daily Awareness V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert daily awareness into a globally shared, event-driven brief service with a secured internal Inbox endpoint, durable asynchronous processing, deterministic state and retry handling, read-only user experience, and administrator operations.

**Architecture:** Extend the existing PostgreSQL, NestJS, RBAC, and Vue implementation without adding a queue or ORM. Persist internal completion events first, process them with a recoverable polling worker under one PostgreSQL advisory lock per business date, keep model calls outside database transactions, and expose separate query and administration services while retaining compatibility adapters for old brief IDs.

**Tech Stack:** TypeScript 6, NestJS 11, PostgreSQL/`pg`, OpenAI-compatible SDK, Vue 3, Node test runner through `tsx`, existing DOCX export.

## Global Constraints

- Do not add Kafka, BullMQ, an ORM, a new state-management framework, or another infrastructure dependency.
- Do not delete existing `daily_briefs`, `daily_brief_events`, or historical brief content.
- `POST /internal/events/daily-data-finished` uses an independent internal key and never uses user JWT authentication.
- The internal request persists Inbox state and returns HTTP 202 before any material query or model call.
- `event_id`, day `business_date`, and global brief `brief_date` provide layered idempotency.
- Every automatic, retry, replay, and manual path uses the same business-date advisory lock.
- Model calls never execute inside an open database transaction.
- Inbox replay never overwrites a successful global brief; only explicit manual regeneration with a reason and confirmation may overwrite one.
- Users see one shared global brief and never see provider errors, quota details, or summary-missing counts.
- The user page is read-only; generation settings belong only to management.
- No management control may enable/disable automatic processing or set a daily clock time.
- Preserve unrelated dirty-worktree changes.

---

## File Structure

**New backend files**

- `server/daily-awareness.constants.ts`: fixed enums, error codes, message codes, and prompt version.
- `server/daily-awareness.contracts.ts`: event, state, run, config, and API response interfaces.
- `server/internal-event-key.guard.ts`: constant-time internal-key authentication.
- `server/daily-awareness.internal.controller.ts`: internal event endpoint.
- `server/daily-awareness-inbox.service.ts`: Inbox insertion, claiming, leases, retries, and dead letters.
- `server/daily-awareness-lock.service.ts`: shared business-date advisory lock.
- `server/daily-awareness-worker.service.ts`: recoverable polling worker.
- `server/daily-awareness-material.service.ts`: business-date material query and quality preparation.
- `server/daily-awareness-prompt.ts`: versioned prompts, including title-only constraints.
- `server/daily-awareness-generation.service.ts`: generation state machine, model retry, validation, and transactional save.
- `server/daily-awareness-query.service.ts`: current/history/date fallback queries.
- `server/daily-awareness-config.service.ts`: singleton config and version validation.
- `server/daily-awareness-admin.controller.ts`: status, config, runs, replay, and regeneration endpoints.
- `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`: management UI.

**Modified backend files**

- `scripts/init-daily-awareness.sql`: additive schema, constraints, canonical migration, and defaults.
- `scripts/init-rbac.sql`: new permissions and role migration.
- `server/daily-awareness.types.ts`: compatibility aliases and material summary fields.
- `server/daily-awareness.utils.ts`: source-preserving grouping and title-only candidate support.
- `server/vector-source.service.ts`: separate summary selection and business-date diagnostics.
- `server/daily-awareness.service.ts`: compatibility facade and existing export/event mapping.
- `server/daily-awareness.controller.ts`: read APIs and guarded legacy adapters.
- `server/permissions.guard.ts`: permission-record-only authorization.
- `server/permission-modules.ts`: new daily view permission and admin manage permission.
- `server/app.module.ts`: controllers and providers.
- `server/config.ts`, `.env.example`, `deploy.sh`, `README.md`: internal-event and worker contract.

**Modified frontend files**

- `b_k3ewYvsOEc1/src/lib/api.js`: current/history/admin API clients.
- `b_k3ewYvsOEc1/src/lib/permissionModules.js`: new permission mapping.
- `b_k3ewYvsOEc1/src/App.vue`: view/manage entry guards and management workspace.
- `b_k3ewYvsOEc1/src/components/DailyAwareness.vue`: read-only current/history page.
- `b_k3ewYvsOEc1/src/components/UserManagement.vue`: system-management navigation entry.

**Tests**

- `tests/daily-awareness-v2-schema.test.ts`
- `tests/daily-awareness-internal-events.test.ts`
- `tests/daily-awareness-worker.test.ts`
- `tests/daily-awareness-material-quality.test.ts`
- `tests/daily-awareness-generation.test.ts`
- `tests/daily-awareness-query.test.ts`
- `tests/daily-awareness-admin.test.ts`
- `tests/daily-awareness-v2-permissions.test.ts`
- `tests/frontend-daily-awareness-v2.test.ts`
- Existing related tests updated only where the approved behavior intentionally changes.

---

### Task 1: Fixed Contracts, Additive Schema, and Historical Migration

**Files:**
- Create: `server/daily-awareness.constants.ts`
- Create: `server/daily-awareness.contracts.ts`
- Create: `tests/daily-awareness-v2-schema.test.ts`
- Modify: `scripts/init-daily-awareness.sql`
- Modify: `server/daily-awareness.types.ts`

**Interfaces:**
- Produces: `DailyAwarenessInboxStatus`, `DailyAwarenessDataStatus`, `DailyAwarenessGenerationStatus`, `DailyAwarenessQualityStatus`, `DailyAwarenessRunStatus`, `DailyAwarenessTriggerType`, `DailyAwarenessMessageCode`.
- Produces: `DailyDataFinishedEvent`, `DailyAwarenessCurrentResponse`, `DailyAwarenessPreparedMaterials`, `DailyAwarenessConfig`.

- [ ] **Step 1: Write the failing contract and schema tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DAILY_AWARENESS_DATA_STATUSES,
  DAILY_AWARENESS_GENERATION_STATUSES,
  DAILY_AWARENESS_INBOX_STATUSES,
  DAILY_AWARENESS_QUALITY_STATUSES,
} from '../server/daily-awareness.constants.js';

test('daily awareness v2 exposes fixed status enums', () => {
  assert.deepEqual(DAILY_AWARENESS_INBOX_STATUSES, ['RECEIVED', 'PROCESSING', 'RETRY_PENDING', 'PROCESSED', 'DEAD_LETTER']);
  assert.deepEqual(DAILY_AWARENESS_DATA_STATUSES, ['WAITING', 'READY', 'NO_DATA']);
  assert.ok(DAILY_AWARENESS_GENERATION_STATUSES.includes('NOT_REQUIRED'));
  assert.deepEqual(DAILY_AWARENESS_QUALITY_STATUSES, ['NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY']);
});

test('daily awareness migration is additive and idempotent', async () => {
  const sql = await readFile(new URL('../scripts/init-daily-awareness.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_event_inbox/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_day_status/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_runs/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_config/i);
  assert.match(sql, /WHERE publication_scope = 'GLOBAL'/i);
  assert.match(sql, /row_number\(\).*PARTITION BY brief_date/is);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE\s+daily_briefs|DELETE\s+FROM\s+daily_briefs/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/daily-awareness-v2-schema.test.ts`  
Expected: FAIL because `daily-awareness.constants.ts` and the V2 tables do not exist.

- [ ] **Step 3: Add fixed constants and contracts**

```ts
export const DAILY_AWARENESS_INBOX_STATUSES = ['RECEIVED', 'PROCESSING', 'RETRY_PENDING', 'PROCESSED', 'DEAD_LETTER'] as const;
export const DAILY_AWARENESS_DATA_STATUSES = ['WAITING', 'READY', 'NO_DATA'] as const;
export const DAILY_AWARENESS_GENERATION_STATUSES = ['WAITING', 'PENDING', 'GENERATING', 'SUCCESS', 'GENERATION_FAILED', 'NOT_REQUIRED'] as const;
export const DAILY_AWARENESS_QUALITY_STATUSES = ['NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY'] as const;
export const DAILY_AWARENESS_TRIGGER_TYPES = ['EVENT', 'AUTO_RETRY', 'MANUAL', 'INBOX_REPROCESS'] as const;
export const DAILY_AWARENESS_RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCESS', 'NO_DATA', 'FAILED', 'IGNORED_DUPLICATE'] as const;
export const DAILY_AWARENESS_PROMPT_VERSION = 'daily-awareness-v2.0';
```

Define contracts with unions derived from these arrays and require the exact internal event fields. Extend `DailyAwarenessMaterial` with `summary: string` while retaining `content` for compatibility.

- [ ] **Step 4: Add additive tables, checks, indexes, and canonical migration**

Implement `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, four `CREATE TABLE IF NOT EXISTS` statements, one-row config insertion, enum `CHECK` constraints guarded by `DO $$` blocks, canonical `row_number() OVER (PARTITION BY brief_date ORDER BY updated_at DESC, created_at DESC, brief_id DESC)`, and the partial global-date unique index. Do not alter or delete legacy event rows.

- [ ] **Step 5: Run schema tests and build**

Run: `npx tsx --test tests/daily-awareness-v2-schema.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/daily-awareness.constants.ts server/daily-awareness.contracts.ts server/daily-awareness.types.ts scripts/init-daily-awareness.sql tests/daily-awareness-v2-schema.test.ts
git commit -m "feat: add daily awareness v2 data contracts"
```

### Task 2: Internal-Key Event Endpoint and Inbox Idempotency

**Files:**
- Create: `server/internal-event-key.guard.ts`
- Create: `server/daily-awareness.internal.controller.ts`
- Create: `server/daily-awareness-inbox.service.ts`
- Create: `tests/daily-awareness-internal-events.test.ts`
- Modify: `server/app.module.ts`
- Modify: `server/config.ts`

**Interfaces:**
- Consumes: `DailyDataFinishedEvent` and Inbox statuses from Task 1.
- Produces: `DailyAwarenessInboxService.accept(event): Promise<{ accepted: true; duplicate: boolean; eventId: string }>`.
- Produces: `DailyAwarenessInboxService.wake(): void` for non-blocking worker notification.

- [ ] **Step 1: Write failing endpoint tests**

Test a Nest application with the real guard/controller and a fake Inbox service:

```ts
test('internal event endpoint rejects missing key and accepts a valid event with 202', async () => {
  const missing = await fetch(`${baseUrl}/internal/events/daily-data-finished`, { method: 'POST' });
  assert.equal(missing.status, 401);
  const accepted = await fetch(`${baseUrl}/internal/events/daily-data-finished`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'test-secret' },
    body: JSON.stringify(validEvent),
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false, eventId: validEvent.eventId });
  assert.equal(generateCalls, 0);
});
```

Add cases for incorrect key, invalid type/date/count, and duplicate event returning 202 with `duplicate: true`.

- [ ] **Step 2: Run and verify RED**

Run: `DAILY_AWARENESS_INTERNAL_EVENT_KEY=test-secret npx tsx --test tests/daily-awareness-internal-events.test.ts`  
Expected: FAIL because the guard, controller, and Inbox service are missing.

- [ ] **Step 3: Implement constant-time internal authentication**

Read `x-hermes-internal-key`, reject unconfigured service with 503 and absent/incorrect credentials with 401. Compare equal-length buffers through `crypto.timingSafeEqual`; never log the credential.

- [ ] **Step 4: Implement event validation and Inbox insert**

Use parameterized SQL:

```sql
INSERT INTO daily_awareness_event_inbox
  (event_id, event_type, business_date, batch_id, completed_at, total_count, payload, status)
VALUES ($1, $2, $3::date, $4, $5::timestamptz, $6, $7::jsonb, 'RECEIVED')
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id
```

Call `wake()` after the insert attempt and return duplicate status from `rowCount` without querying or generating a brief.

- [ ] **Step 5: Run endpoint tests and build**

Run: `DAILY_AWARENESS_INTERNAL_EVENT_KEY=test-secret npx tsx --test tests/daily-awareness-internal-events.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal-event-key.guard.ts server/daily-awareness.internal.controller.ts server/daily-awareness-inbox.service.ts server/app.module.ts server/config.ts tests/daily-awareness-internal-events.test.ts
git commit -m "feat: accept durable daily data completion events"
```

### Task 3: Recoverable Worker and Shared Business-Date Lock

**Files:**
- Create: `server/daily-awareness-lock.service.ts`
- Create: `server/daily-awareness-worker.service.ts`
- Create: `tests/daily-awareness-worker.test.ts`
- Modify: `server/daily-awareness-inbox.service.ts`
- Modify: `server/app.module.ts`

**Interfaces:**
- Produces: `DailyAwarenessLockService.withBusinessDateLock<T>(date, mode, work): Promise<{ acquired: boolean; value?: T }>`.
- Produces: `DailyAwarenessWorkerService.processAvailable(): Promise<number>`.
- Consumes later: `DailyAwarenessGenerationService.processEvent(...)` through injection.

- [ ] **Step 1: Write failing worker tests**

Cover stale lease recovery, `FOR UPDATE SKIP LOCKED`, retry scheduling, dead letter transition, business terminal status marking Inbox `PROCESSED`, and one lock helper used by every trigger mode.

```ts
test('worker marks model-terminal failures processed but dead-letters infrastructure failures', async () => {
  generation.processEvent = async () => ({ terminal: true, generationStatus: 'GENERATION_FAILED' });
  await worker.processAvailable();
  assert.equal(inbox.status, 'PROCESSED');

  generation.processEvent = async () => { throw Object.assign(new Error('database unavailable'), { infrastructure: true }); };
  await worker.processAvailable();
  assert.equal(inbox.status, 'RETRY_PENDING');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-worker.test.ts`  
Expected: FAIL because worker and lock services are missing.

- [ ] **Step 3: Implement the advisory lock**

Acquire a dedicated `pg` client, call `pg_try_advisory_lock(hashtext('daily-awareness'), hashtext($1))`, execute `work` without an open transaction, and always call `pg_advisory_unlock` plus `client.release()` in `finally`.

- [ ] **Step 4: Implement Inbox leases and worker lifecycle**

Claim in a short transaction, commit before processing, and recover `PROCESSING` rows whose `locked_at` exceeds the configured lease. Poll only when initialized and use `wake()` to schedule an immediate pass without awaiting it in the HTTP request.

- [ ] **Step 5: Run tests and build**

Run: `npx tsx --test tests/daily-awareness-worker.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/daily-awareness-lock.service.ts server/daily-awareness-worker.service.ts server/daily-awareness-inbox.service.ts server/app.module.ts tests/daily-awareness-worker.test.ts
git commit -m "feat: process daily awareness inbox asynchronously"
```

### Task 4: Material Quality, Title-Only Degradation, and Source-Preserving Aggregation

**Files:**
- Create: `server/daily-awareness-material.service.ts`
- Create: `tests/daily-awareness-material-quality.test.ts`
- Modify: `server/vector-source.service.ts`
- Modify: `server/daily-awareness.utils.ts`
- Modify: `server/daily-awareness.types.ts`
- Modify: `server/daily-awareness.utils.test.ts`

**Interfaces:**
- Produces: `prepareForBusinessDate(date, config): Promise<DailyAwarenessPreparedMaterials>`.
- Output includes `materials`, `candidates`, `sourceCount`, `summaryCount`, `titleOnlyCount`, `skippedCount`, `qualityStatus`, and diagnostics.

- [ ] **Step 1: Write failing quality tests**

```ts
test('keeps titled materials when summary is empty', () => {
  const prepared = prepareDailyAwarenessMaterials([
    material({ title: '有摘要', summary: '摘要内容' }),
    material({ title: '只有标题', summary: '', content: '' }),
    material({ title: '', summary: '无标题摘要' }),
  ]);
  assert.equal(prepared.sourceCount, 2);
  assert.equal(prepared.summaryCount, 1);
  assert.equal(prepared.titleOnlyCount, 1);
  assert.equal(prepared.skippedCount, 1);
  assert.equal(prepared.qualityStatus, 'PARTIAL_SUMMARY');
  assert.equal(prepared.candidates.find((item) => item.title === '只有标题')?.summaryText, '只有标题');
});
```

Add NORMAL, TITLE_ONLY, deterministic truncation, URL dedupe, and two-source same-title aggregation tests.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-material-quality.test.ts server/daily-awareness.utils.test.ts`  
Expected: FAIL because title-only materials are currently discarded and same-title sources are removed before grouping.

- [ ] **Step 3: Separate summary from fallback content in vector retrieval**

Select `material_summary` independently from `material_content`; prioritize an explicit/discovered business-date expression and record a diagnostic when published time is used as fallback. Map titled rows even when both summary and content are empty.

- [ ] **Step 4: Implement deterministic quality preparation**

Trim and truncate summary to `summary_max_chars`, skip titleless rows, compute counts, and set quality. URL-dedupe first, then group by normalized title so up to five sources survive. Preserve all related material IDs and keep the existing 70/30 final score.

- [ ] **Step 5: Run material tests and build**

Run: `npx tsx --test tests/daily-awareness-material-quality.test.ts server/daily-awareness.utils.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/daily-awareness-material.service.ts server/vector-source.service.ts server/daily-awareness.utils.ts server/daily-awareness.types.ts server/daily-awareness.utils.test.ts tests/daily-awareness-material-quality.test.ts
git commit -m "feat: degrade daily awareness materials by summary quality"
```

### Task 5: Generation State Machine, Prompt Versioning, Retry, and Transactional Save

**Files:**
- Create: `server/daily-awareness-prompt.ts`
- Create: `server/daily-awareness-generation.service.ts`
- Create: `tests/daily-awareness-generation.test.ts`
- Modify: `server/daily-awareness.service.ts`
- Modify: `server/app.module.ts`

**Interfaces:**
- Produces: `processEvent(event): Promise<DailyAwarenessTerminalResult>`.
- Produces: `regenerate(input, actor): Promise<{ runId: string }>`.
- Consumes: material, config, lock, Inbox, and existing model/export helpers.

- [ ] **Step 1: Write failing state-machine tests**

Cover NO_DATA without model invocation, PARTIAL_SUMMARY success, TITLE_ONLY prompt restriction, retryable timeout then success, non-retryable error, exhausted retry to GENERATION_FAILED, explicit manual overwrite, and transaction boundaries.

```ts
test('commits generating state before calling the model', async () => {
  await generation.processEvent(event);
  assert.deepEqual(callOrder, ['begin-state-tx', 'commit-state-tx', 'model-call', 'begin-save-tx', 'commit-save-tx']);
});

test('inbox replay cannot overwrite an existing successful global brief', async () => {
  const result = await generation.processEvent(event, { triggerType: 'INBOX_REPROCESS' });
  assert.equal(result.runStatus, 'IGNORED_DUPLICATE');
  assert.equal(saveCalls, 0);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-generation.test.ts`  
Expected: FAIL because the generation state machine does not exist.

- [ ] **Step 3: Add versioned normal and title-only prompts**

Export prompt builders with `DAILY_AWARENESS_PROMPT_VERSION`. The title-only system prompt must state: `只能依据输入标题组织概览，不得补充标题中未明确体现的事实、数字、原因或结论。`

- [ ] **Step 4: Implement state transitions and retry classification**

Create a run per attempt. Retry only timeouts, 429, connection resets, and 5xx responses. Validate nonempty/usable model output. For zero usable records write `READY -> NO_DATA`, `generation_status = NOT_REQUIRED`, run `NO_DATA`, and no brief.

- [ ] **Step 5: Implement short-transaction save**

Within one post-model transaction: upsert the `GLOBAL` brief by date, delete/reinsert only that global brief's event rows, update day status to SUCCESS, and update run to SUCCESS. Manual regeneration may overwrite; all other successful-date paths return `IGNORED_DUPLICATE`.

- [ ] **Step 6: Run generation tests and build**

Run: `npx tsx --test tests/daily-awareness-generation.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/daily-awareness-prompt.ts server/daily-awareness-generation.service.ts server/daily-awareness.service.ts server/app.module.ts tests/daily-awareness-generation.test.ts
git commit -m "feat: generate global daily awareness briefs asynchronously"
```

### Task 6: Current Brief Fallback and User APIs

**Files:**
- Create: `server/daily-awareness-query.service.ts`
- Create: `tests/daily-awareness-query.test.ts`
- Modify: `server/daily-awareness.controller.ts`
- Modify: `server/daily-awareness.service.ts`
- Modify: `server/app.module.ts`
- Modify: `server/daily-awareness.download.test.ts`

**Interfaces:**
- Produces: `current(businessDate, user): Promise<DailyAwarenessCurrentResponse>`.
- Produces: successful global history and exact-date detail/export.

- [ ] **Step 1: Write failing fallback matrix tests**

Table-drive SUCCESS, NO_DATA, GENERATING, GENERATION_FAILED, WAITING, and no-history cases. Assert both today's business date and the displayed brief date.

```ts
assert.deepEqual(await query.current('2026-07-16'), {
  businessDate: '2026-07-16',
  dataStatus: 'NO_DATA',
  generationStatus: 'NOT_REQUIRED',
  qualityStatus: null,
  messageCode: 'TODAY_NO_DATA',
  displayedBrief: previousBrief,
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-query.test.ts`  
Expected: FAIL because query service/current endpoint are missing.

- [ ] **Step 3: Implement global queries**

Read only `publication_scope = 'GLOBAL'` and successful briefs. Exact-date detail never falls back. History excludes NO_DATA and failed dates. Current performs one backend decision and strips owner/provider/internal statistics from the user payload.

- [ ] **Step 4: Add guarded routes and compatibility adapters**

Add `/current`, `/history`, `/briefs/by-date/:businessDate`, and export under `daily-awareness:view`. Retain old `briefId` routes; the old synchronous `generate` route requires `system:daily-awareness:manage` and delegates to asynchronous regeneration rather than waiting for a model.

- [ ] **Step 5: Run query/download tests and build**

Run: `npx tsx --test tests/daily-awareness-query.test.ts server/daily-awareness.download.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/daily-awareness-query.service.ts server/daily-awareness.controller.ts server/daily-awareness.service.ts server/app.module.ts server/daily-awareness.download.test.ts tests/daily-awareness-query.test.ts
git commit -m "feat: serve shared daily awareness briefs with fallback"
```

### Task 7: Administration APIs, Config Versioning, Replay, and Manual Regeneration

**Files:**
- Create: `server/daily-awareness-config.service.ts`
- Create: `server/daily-awareness-admin.controller.ts`
- Create: `tests/daily-awareness-admin.test.ts`
- Modify: `server/daily-awareness-inbox.service.ts`
- Modify: `server/daily-awareness-generation.service.ts`
- Modify: `server/app.module.ts`

**Interfaces:**
- Produces status/config/runs/inbox list APIs.
- Produces `reprocess(eventId, actor)` and `regenerate({ businessDate, reason, confirmOverwrite }, actor)`.

- [ ] **Step 1: Write failing admin tests**

Cover config version conflicts, filters, error redaction, missing reason, missing overwrite confirmation, same-date 409, dead-letter replay, and successful-brief replay protection.

```ts
await assert.rejects(
  () => inbox.reprocess('event-success', admin),
  (error) => errorCode(error) === 'DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS',
);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-admin.test.ts`  
Expected: FAIL because admin controller/config service are missing.

- [ ] **Step 3: Implement config and read endpoints**

Validate integer ranges and category arrays. Update with `WHERE id = 1 AND version = $expectedVersion`, increment version, and audit before/after values. Return only redacted run errors.

- [ ] **Step 4: Implement replay and explicit regeneration**

Replay changes DEAD_LETTER to RETRY_PENDING only when no global SUCCESS exists. Regeneration requires `confirmOverwrite: true`, records actor/reason, acquires the shared lock asynchronously, returns 202 `runId`, and may overwrite only through trigger type MANUAL.

- [ ] **Step 5: Run admin tests and build**

Run: `npx tsx --test tests/daily-awareness-admin.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/daily-awareness-config.service.ts server/daily-awareness-admin.controller.ts server/daily-awareness-inbox.service.ts server/daily-awareness-generation.service.ts server/app.module.ts tests/daily-awareness-admin.test.ts
git commit -m "feat: manage daily awareness operations"
```

### Task 8: RBAC Migration and Explicit Permission Enforcement

**Files:**
- Create: `tests/daily-awareness-v2-permissions.test.ts`
- Modify: `scripts/init-rbac.sql`
- Modify: `server/permission-modules.ts`
- Modify: `server/permissions.guard.ts`
- Modify: `server/auth.service.ts`
- Modify: `server/roles.service.ts`
- Modify: `tests/account-permissions.test.ts`
- Modify: `tests/module-permissions.test.ts`
- Modify: `tests/owner-isolation.test.ts`

**Interfaces:**
- Produces exact permissions `daily-awareness:view` and `system:daily-awareness:manage`.
- Daily business module maps only to view; admin fallback maps to both.

- [ ] **Step 1: Write failing permission tests**

Assert no role-name bypass, view/manage separation, old-read migration SQL, user endpoint guards, admin endpoint guards, and compatibility generate guard.

```ts
test('admin role name does not bypass missing permission records', () => {
  assert.throws(() => guardFor(['daily-awareness:view']).canActivate(contextFor({ role: 'admin', roles: ['admin'], permissions: [] })), /Insufficient permissions/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/daily-awareness-v2-permissions.test.ts tests/account-permissions.test.ts tests/module-permissions.test.ts`  
Expected: FAIL because old permission names and admin bypass remain.

- [ ] **Step 3: Add permission records and safe role migration**

Insert new permissions, copy role assignments from `daily_awareness:read` to view, and explicitly grant admin view/manage. Keep old records during compatibility. Do not grant manage through the daily business module.

- [ ] **Step 4: Remove role-name bypass and update fallbacks**

Require `user.permissions` for every `PermissionsGuard` decision. Ensure authentication fallback/admin system permission lists contain all required permissions, so correctly seeded admins retain access.

- [ ] **Step 5: Run permission and owner tests**

Run: `npx tsx --test tests/daily-awareness-v2-permissions.test.ts tests/account-permissions.test.ts tests/module-permissions.test.ts tests/owner-isolation.test.ts`  
Expected: PASS with global daily brief expectations replacing daily owner isolation.

- [ ] **Step 6: Commit**

```bash
git add scripts/init-rbac.sql server/permission-modules.ts server/permissions.guard.ts server/auth.service.ts server/roles.service.ts tests/daily-awareness-v2-permissions.test.ts tests/account-permissions.test.ts tests/module-permissions.test.ts tests/owner-isolation.test.ts
git commit -m "feat: migrate daily awareness permissions"
```

### Task 9: Read-Only User Page and New Current API Client

**Files:**
- Create: `tests/frontend-daily-awareness-v2.test.ts`
- Modify: `b_k3ewYvsOEc1/src/lib/api.js`
- Modify: `b_k3ewYvsOEc1/src/lib/permissionModules.js`
- Modify: `b_k3ewYvsOEc1/src/App.vue`
- Modify: `b_k3ewYvsOEc1/src/components/DailyAwareness.vue`

**Interfaces:**
- Consumes `/current`, `/history`, exact-date detail/export, and `messageCode`.
- Produces a read-only daily workspace guarded by `daily-awareness:view`.

- [ ] **Step 1: Write failing frontend source-contract tests**

Read Vue/JS source and assert the new endpoints and copy exist while generation controls do not:

```ts
assert.match(dailySource, /今日业务日期/);
assert.match(dailySource, /当前展示/);
assert.match(dailySource, /简要版/);
assert.doesNotMatch(dailySource, /最大条数|回溯小时|生成每日简报|重新生成/);
assert.match(apiSource, /daily-awareness\/current/);
assert.match(appSource, /daily-awareness:view/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`  
Expected: FAIL because generation settings remain and current API is missing.

- [ ] **Step 3: Add API clients and permission mapping**

Implement `getCurrentDailyAwareness`, `getDailyAwarenessHistory`, exact-date detail/export, and management clients. Map the daily module to view only and gate App entry directly on permissions.

- [ ] **Step 4: Refactor the page to read-only state**

Remove filters, generate/recovery polling, diagnostics, and settings sidebar. Load `/current` on mount, render Banner from a fixed message map, show both dates, show TITLE_ONLY badge, retain history/copy/export/draft import, and suppress today's Banner in selected-history mode.

- [ ] **Step 5: Run frontend contract and build checks**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add b_k3ewYvsOEc1/src/lib/api.js b_k3ewYvsOEc1/src/lib/permissionModules.js b_k3ewYvsOEc1/src/App.vue b_k3ewYvsOEc1/src/components/DailyAwareness.vue tests/frontend-daily-awareness-v2.test.ts
git commit -m "feat: make daily awareness a read-only workspace"
```

### Task 10: Daily Awareness Management Page

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`
- Modify: `b_k3ewYvsOEc1/src/components/UserManagement.vue`
- Modify: `b_k3ewYvsOEc1/src/App.vue`
- Modify: `b_k3ewYvsOEc1/src/lib/api.js`
- Modify: `tests/frontend-daily-awareness-v2.test.ts`

**Interfaces:**
- Consumes admin status/config/runs/inbox/regenerate APIs.
- Requires `system:daily-awareness:manage` and does not imply view.

- [ ] **Step 1: Extend failing frontend tests**

Assert status cards, config fields, run/dead-letter views, reason and overwrite confirmation, and absence of schedule/enable controls.

```ts
assert.match(adminSource, /运行状态/);
assert.match(adminSource, /手动补生成/);
assert.match(adminSource, /死信/);
assert.match(adminSource, /confirmOverwrite/);
assert.doesNotMatch(adminSource, /每日生成时间|定时任务开关/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`  
Expected: FAIL because the management component does not exist.

- [ ] **Step 3: Implement management API bindings and page**

Build quiet operational UI sections for status, config, manual regeneration, runs, and dead letters. Use inputs for numeric config, checkboxes/confirmation for overwrite, tabs for views, and icon buttons where the existing library supports them. Handle 409 and version conflict explicitly.

- [ ] **Step 4: Integrate with existing system management**

Allow the system-management entry when the user has user manage, role manage, or daily manage. Show the daily-awareness tab only with manage permission. Do not mount the component for unauthorized users.

- [ ] **Step 5: Run frontend tests, lint, and build**

Run: `npx tsx --test tests/frontend-daily-awareness-v2.test.ts`  
Expected: PASS.  
Run: `npm run lint`  
Expected: PASS.  
Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue b_k3ewYvsOEc1/src/components/UserManagement.vue b_k3ewYvsOEc1/src/App.vue b_k3ewYvsOEc1/src/lib/api.js tests/frontend-daily-awareness-v2.test.ts
git commit -m "feat: add daily awareness operations console"
```

### Task 11: Deployment Contract, Integration Coverage, and Final Verification

**Files:**
- Modify: `.env.example`
- Modify: `deploy.sh`
- Modify: `README.md`
- Create: `tests/daily-awareness-v2-integration.test.ts`
- Modify: relevant existing tests only when failures demonstrate approved behavior changes.

**Interfaces:**
- Documents internal endpoint headers/payload, deployment order, worker settings, curl example, and rollback behavior.

- [ ] **Step 1: Write the failing integration test**

Exercise: valid event -> 202 -> Inbox -> worker -> global brief; duplicate event; NO_DATA; model failure terminal processing; dead letter replay; same-date lock; successful-date replay protection; explicit manual overwrite.

- [ ] **Step 2: Run and verify RED**

Run: `DAILY_AWARENESS_INTERNAL_EVENT_KEY=test-secret npx tsx --test tests/daily-awareness-v2-integration.test.ts`  
Expected: FAIL until all adapters are wired through `AppModule`.

- [ ] **Step 3: Add environment and deployment documentation**

Add exact variables:

```dotenv
DAILY_AWARENESS_INTERNAL_EVENT_KEY=
DAILY_AWARENESS_WORKER_POLL_MS=2000
DAILY_AWARENESS_INBOX_LEASE_SECONDS=300
DAILY_AWARENESS_INBOX_MAX_ATTEMPTS=5
```

Document schema -> permission mapping -> backend -> verification -> frontend -> writer integration order and include the approved curl request. Do not add a UI or environment switch that disables processing.

- [ ] **Step 4: Run the complete focused suite**

Run:

```bash
npx tsx --test \
  tests/daily-awareness-v2-schema.test.ts \
  tests/daily-awareness-internal-events.test.ts \
  tests/daily-awareness-worker.test.ts \
  tests/daily-awareness-material-quality.test.ts \
  tests/daily-awareness-generation.test.ts \
  tests/daily-awareness-query.test.ts \
  tests/daily-awareness-admin.test.ts \
  tests/daily-awareness-v2-permissions.test.ts \
  tests/frontend-daily-awareness-v2.test.ts \
  tests/daily-awareness-v2-integration.test.ts \
  server/daily-awareness.utils.test.ts \
  server/daily-awareness.download.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run regression verification**

Run: `npm run build`  
Expected: PASS.  
Run: `npm run lint`  
Expected: PASS.  
Run the repository's existing standalone account, module, owner, auth, draft, QA, and report test files with `npx tsx --test`; expected all PASS.

- [ ] **Step 6: Inspect final diff and migration safety**

Run: `git diff --check`  
Expected: no output.  
Run: `git status --short`  
Expected: only intentional task files plus the user's pre-existing unrelated changes.  
Confirm no secret values, destructive migration statements, schedule controls, or queue dependencies were introduced.

- [ ] **Step 7: Commit**

```bash
git add .env.example deploy.sh README.md tests/daily-awareness-v2-integration.test.ts
git commit -m "docs: publish daily awareness event integration contract"
```

## Execution Notes

- Execute inline in this session because the user did not request subagents and the repository contains unrelated uncommitted work that must remain untouched.
- Before each task, re-check `git status --short` and only stage files owned by that task.
- If an existing dirty file must be modified, preserve and integrate the user's lines rather than replacing the file wholesale.
- Stop a task at its failing-test checkpoint if the failure reveals a contradiction with the approved design; update the design before proceeding.
