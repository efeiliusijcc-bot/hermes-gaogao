# Daily Awareness Previous-Day Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate each day's Daily Awareness brief automatically at 06:00 Asia/Shanghai from the previous day's MySQL table, waiting until 08:00 when that table is late.

**Architecture:** Add a small in-process scheduler that idempotently inserts a stable automatic Inbox event after 06:00. Normalize every event to a server-derived previous-day source context, reuse the existing Worker and state machine, and add a special 15-minute missing-table retry disposition that ignores the normal short Inbox retry limit until the 08:00 deadline.

**Tech Stack:** NestJS, TypeScript, PostgreSQL, MySQL, Vue 3, Node test runner, Docker.

## Global Constraints

- Use `Asia/Shanghai` for business-day and schedule calculations.
- `businessDate=D` always reads MySQL `data_(D-1)` for new automatic, external-event, Inbox-reprocess, and manual runs.
- Run at 06:00; retry a missing source table every 15 minutes through 08:00.
- Do not introduce Kafka, a message bus, server Cron, or a new scheduling dependency.
- Automatic and replay paths never overwrite an existing successful global brief.
- Model calls remain outside long database transactions.
- Existing historical briefs are not migrated or rewritten.

---

### Task 1: Previous-day source context and schema

**Files:**
- Create: `server/daily-awareness-date.ts`
- Modify: `server/daily-awareness-material.service.ts`
- Modify: `server/daily-awareness-generation.service.ts`
- Modify: `server/daily-awareness-generation.store.ts`
- Modify: `server/daily-awareness.contracts.ts`
- Modify: `scripts/init-daily-awareness.sql`
- Test: `tests/daily-awareness-scheduler.test.ts`
- Test: `tests/daily-awareness-generation.test.ts`
- Test: `tests/daily-awareness-v2-schema.test.ts`

**Interfaces:**
- Produces `dailyAwarenessSourceContext(businessDate: string)` returning `{ sourceBusinessDate, sourceTable, dataWaitDeadline }`.
- Persists `source_business_date`, `source_table`, and `data_wait_deadline` on runs and source fields on briefs.

- [ ] **Step 1: Write failing date and schema tests.** Cover month/year/leap-day previous-date mapping, `2026-07-18 -> data_20260717`, manual source mapping, and additive nullable columns.
- [ ] **Step 2: Run focused tests and verify expected missing-helper/column failures.**

```bash
node --import tsx --test tests/daily-awareness-scheduler.test.ts tests/daily-awareness-generation.test.ts tests/daily-awareness-v2-schema.test.ts
```

- [ ] **Step 3: Implement the pure date helper.** Validate date-only strings, use UTC arithmetic on date components, and build the 08:00 deadline with `+08:00`.
- [ ] **Step 4: Normalize source metadata before taking the business-date lock.** Merge server-derived values into the event payload and pass `sourceBusinessDate` to the material service.
- [ ] **Step 5: Persist source metadata.** Add idempotent nullable columns and write them in queued/running/success records without changing historical rows.
- [ ] **Step 6: Rerun the focused tests and commit.**

```bash
git add server/daily-awareness-date.ts server/daily-awareness-material.service.ts server/daily-awareness-generation.service.ts server/daily-awareness-generation.store.ts server/daily-awareness.contracts.ts scripts/init-daily-awareness.sql tests/daily-awareness-scheduler.test.ts tests/daily-awareness-generation.test.ts tests/daily-awareness-v2-schema.test.ts
git commit -m "feat: read previous-day daily awareness data"
```

### Task 2: 06:00 idempotent application scheduler

**Files:**
- Create: `server/daily-awareness-scheduler.service.ts`
- Modify: `server/daily-awareness-inbox.service.ts`
- Modify: `server/app.module.ts`
- Modify: `server/config.ts`
- Modify: `.env.example`
- Test: `tests/daily-awareness-scheduler.test.ts`

**Interfaces:**
- Produces `DailyAwarenessSchedulerService.ensureScheduled(now?: Date)` for deterministic tests and runtime polling.
- Produces `DailyAwarenessInboxService.acceptScheduled(event, metadata)` while preserving public `accept(event)`.

- [ ] **Step 1: Add failing scheduler tests.** Cover before 06:00, exactly/after 06:00, stable event IDs, successful-brief skip, duplicate polls, and restart catch-up.
- [ ] **Step 2: Run the scheduler test and verify missing-service failures.**
- [ ] **Step 3: Add bounded schedule configuration.** Parse `HH:mm`, booleans, retry minutes, and poll interval with safe defaults.
- [ ] **Step 4: Implement scheduler lifecycle.** Poll every minute, unref the timer, log failures safely, and run an immediate startup check.
- [ ] **Step 5: Register the provider, rerun tests, and commit.**

```bash
git add server/daily-awareness-scheduler.service.ts server/daily-awareness-inbox.service.ts server/app.module.ts server/config.ts .env.example tests/daily-awareness-scheduler.test.ts
git commit -m "feat: schedule daily awareness generation at six"
```

### Task 3: Missing-table wait window and admin observability

**Files:**
- Modify: `server/daily-awareness-inbox.service.ts`
- Modify: `server/daily-awareness-admin.service.ts`
- Modify: `server/daily-awareness-query.service.ts`
- Modify: `server/daily-awareness.contracts.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`
- Test: `tests/daily-awareness-scheduler.test.ts`
- Test: `tests/daily-awareness-admin.test.ts`
- Test: `tests/frontend-daily-awareness-v2.test.ts`

**Interfaces:**
- Produces a pure missing-table retry disposition returning `RETRY_PENDING` plus `nextAttemptAt`, or `DEAD_LETTER` at the deadline.
- Admin responses expose `sourceBusinessDate`, `sourceTable`, `dataWaitDeadline`, and `nextAttemptAt`.

- [ ] **Step 1: Add failing retry-boundary tests.** Verify 06:00 -> 06:15, 07:50 -> 08:00, and missing table at 08:00 -> dead letter regardless of normal max attempts.
- [ ] **Step 2: Add failing admin response and UI assertions.** Require source date/table, retry time, and deadline labels without editable scheduling controls.
- [ ] **Step 3: Implement special missing-table disposition.** Match only `DAILY_AWARENESS_MYSQL_TABLE_NOT_FOUND` with automatic metadata; preserve all other infrastructure behavior.
- [ ] **Step 4: Expose and render source metadata.** Preserve responsive table scrolling and compact row dimensions.
- [ ] **Step 5: Rerun tests and commit.**

```bash
node --import tsx --test tests/daily-awareness-scheduler.test.ts tests/daily-awareness-admin.test.ts tests/frontend-daily-awareness-v2.test.ts
git add server/daily-awareness-inbox.service.ts server/daily-awareness-admin.service.ts server/daily-awareness-query.service.ts server/daily-awareness.contracts.ts b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue tests/daily-awareness-scheduler.test.ts tests/daily-awareness-admin.test.ts tests/frontend-daily-awareness-v2.test.ts
git commit -m "feat: wait for delayed daily awareness tables"
```

### Task 4: Deployment, integration, and release

**Files:**
- Modify: `deploy.sh`
- Modify: `README.md`
- Modify: `tests/deploy-hardening.test.ts`
- Modify: `tests/daily-awareness-v2-integration.test.ts`

**Interfaces:**
- Deployment forwards all scheduler environment values.
- Integration proves automatic event, previous-day source, successful 50-item brief, and replay idempotency.

- [ ] **Step 1: Add failing deployment and integration assertions.** Require seven scheduler settings and production enablement.
- [ ] **Step 2: Update deploy environment and documentation.** Document 06:00, D-1, 15-minute retry, and 08:00 fallback behavior.
- [ ] **Step 3: Run the complete Daily Awareness suite.**

```bash
DAILY_AWARENESS_AUTO_ENABLED=false DAILY_AWARENESS_INTERNAL_EVENT_KEY=test-secret node --import tsx --test server/daily-awareness.download.test.ts server/daily-awareness.utils.test.ts tests/daily-awareness-*.test.ts tests/frontend-daily-awareness-v2.test.ts tests/deploy-hardening.test.ts
```

- [ ] **Step 4: Run production builds and script checks.**

```bash
npm run build
(cd b_k3ewYvsOEc1 && npm run build)
bash -n deploy.sh
git diff --check
```

- [ ] **Step 5: Deploy initially disabled, verify migration/source mapping, enable scheduling, and restart.** Confirm at most one catch-up event and no overwrite of an existing successful brief.
- [ ] **Step 6: Push feature branch and fast-forward `main` without force.**

```bash
git add deploy.sh README.md tests/deploy-hardening.test.ts tests/daily-awareness-v2-integration.test.ts
git commit -m "docs: deploy daily awareness six o'clock schedule"
git push origin codex/daily-awareness-mysql
git push origin HEAD:main
```
