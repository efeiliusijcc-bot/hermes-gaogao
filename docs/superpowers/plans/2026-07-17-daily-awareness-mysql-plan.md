# Daily Awareness MySQL Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Daily Awareness read MySQL `news.data_YYYYMMDD`, expose category selection to administrators, score only titles for the global top 50, and use MySQL `summary` as per-item brief content.

**Architecture:** Add a dedicated `mysql2/promise` source adapter and pool. Keep the existing PostgreSQL Inbox, date lock, run state machine, global brief, retry/dead-letter, and manual overwrite control plane. Normalize MySQL rows into existing candidates; the scoring model receives title/category/tag only, while selected events persist the source summary.

**Tech Stack:** NestJS, TypeScript, mysql2, PostgreSQL, Vue 3, Vite, Node test runner, Docker.

## Global Constraints

- Online source of truth is MySQL `news.data_YYYYMMDD`; PGVector is not used by Daily Awareness generation.
- `designated_tag` is the selectable main category; `tag` is the fine-grained topic; `summary` is not sent to the scoring model.
- Selected categories compete globally for 50 events; no equal category quotas.
- An empty legacy `category_scope` means all four categories: `涉政`, `危安`, `涉华`, `其他`.
- Missing tables and connection failures retry as infrastructure failures; an existing table with no usable rows records `NO_DATA`.
- Model calls stay outside long database transactions and return scores only.
- Inbox replay cannot overwrite a successful global brief.

---

### Task 1: MySQL configuration and source adapter

**Files**

- Modify: `package.json`, `pnpm-lock.yaml`, `server/config.ts`, `server/app.module.ts`, `.env.example`, `deploy.sh`, `README.md`
- Create: `server/daily-awareness-mysql.service.ts`
- Test: `tests/daily-awareness-mysql-source.test.ts`

- [ ] **Step 1: Write the failing tests.** Test `deriveDailyMysqlTableName('2026-07-16') === 'data_20260716'`, reject malformed dates, normalize `ch_title` with `entitle` fallback, map empty `designated_tag` to `其他`, and verify the SQL contains a validated table identifier and parameterized category predicates.
- [ ] **Step 2: Run the tests and verify failure.**

```bash
node --import tsx --test tests/daily-awareness-mysql-source.test.ts
```

Expected: failure because the adapter and helpers do not exist.

- [ ] **Step 3: Add runtime settings.** Add `DAILY_AWARENESS_MYSQL_HOST`, `DAILY_AWARENESS_MYSQL_PORT` (3306), `DAILY_AWARENESS_MYSQL_DATABASE` (news), `DAILY_AWARENESS_MYSQL_USER`, `DAILY_AWARENESS_MYSQL_PASSWORD`, and `DAILY_AWARENESS_MYSQL_TABLE_PREFIX` (data_). Do not reuse `PGVECTOR_DATABASE_URL`.
- [ ] **Step 4: Implement the adapter.** Use a bounded mysql2 pool. Derive only `data_YYYYMMDD` from a validated business date, select required fields, apply selected-category filtering, order by `publish_time DESC, id DESC`, and return normalized rows. Emit `DAILY_AWARENESS_MYSQL_TABLE_NOT_FOUND` for a missing daily table and preserve connection errors for retries.
- [ ] **Step 5: Register and verify.** Register the provider, rerun the focused tests, then commit:

```bash
git add package.json pnpm-lock.yaml server/config.ts server/app.module.ts server/daily-awareness-mysql.service.ts tests/daily-awareness-mysql-source.test.ts .env.example deploy.sh README.md
git commit -m "feat: add MySQL daily awareness source adapter"
```

### Task 2: Title-only scoring and summary preservation

**Files**

- Modify: `server/daily-awareness-material.service.ts`, `server/daily-awareness-generation.service.ts`, `server/daily-awareness.service.ts`, `server/daily-awareness-prompt.ts`, `server/daily-awareness.utils.ts`, `server/app.module.ts`
- Test: `tests/daily-awareness-generation.test.ts`, `tests/daily-awareness-material-quality.test.ts`, `tests/daily-awareness-mysql-source.test.ts`

- [ ] **Step 1: Write failing tests.** Assert the model input contains candidate ID, title, main category, and tag but not the source summary; assert selected `basicSituation/briefContent` equals the source summary; assert category filtering and global 50-event slicing.
- [ ] **Step 2: Run the tests and verify failure.**

```bash
node --import tsx --test tests/daily-awareness-generation.test.ts tests/daily-awareness-material-quality.test.ts tests/daily-awareness-mysql-source.test.ts
```

- [ ] **Step 3: Replace the online material source.** Inject the MySQL adapter, read the selected daily table, normalize title/summary/source metadata, dedupe URL and normalized title, count usable summaries, and map missing table/query errors to the existing retry path.
- [ ] **Step 4: Change prompt and mapping.** Make the fixed model schema return only `candidateId`, `importanceScore`, and `riskScore`. Copy candidate `summaryText` into `basicSituation` after scoring; do not accept model-written `briefContent`.
- [ ] **Step 5: Rank globally.** Keep `0.7 * importance + 0.3 * risk`, apply the category scope before scoring, and slice the global sorted result to 50. Keep the existing model-generated top overview based on selected event content.
- [ ] **Step 6: Verify and commit.**

```bash
node --import tsx --test tests/daily-awareness-generation.test.ts tests/daily-awareness-material-quality.test.ts tests/daily-awareness-mysql-source.test.ts
git add server/daily-awareness-material.service.ts server/daily-awareness-generation.service.ts server/daily-awareness.service.ts server/daily-awareness-prompt.ts server/daily-awareness.utils.ts server/app.module.ts tests/daily-awareness-generation.test.ts tests/daily-awareness-material-quality.test.ts tests/daily-awareness-mysql-source.test.ts
git commit -m "feat: rank MySQL daily awareness titles without rewriting summaries"
```

### Task 3: Administrator category checkboxes

**Files**

- Modify: `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`, `server/daily-awareness-config.service.ts`
- Test: `tests/frontend-daily-awareness-v2.test.ts`, `tests/daily-awareness-admin.test.ts`

- [ ] **Step 1: Write failing tests.** Assert the UI contains four accessible checkbox labels, sends `categoryScope: string[]`, no longer uses the comma-separated text input, and renders an empty stored scope as all four selected.
- [ ] **Step 2: Run the tests and verify failure.**

```bash
node --import tsx --test tests/frontend-daily-awareness-v2.test.ts tests/daily-awareness-admin.test.ts
```

- [ ] **Step 3: Implement fixed validation and UI.** Use the enum `涉政|危安|涉华|其他`, reject a new empty selection, preserve version conflict handling, and keep existing save feedback. A legacy empty value is expanded to all categories only when read.
- [ ] **Step 4: Verify and commit.**

```bash
node --import tsx --test tests/frontend-daily-awareness-v2.test.ts tests/daily-awareness-admin.test.ts
git add b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue server/daily-awareness-config.service.ts tests/frontend-daily-awareness-v2.test.ts tests/daily-awareness-admin.test.ts
git commit -m "feat: configure daily awareness categories with checkboxes"
```

### Task 4: Deployment contract and integration tests

**Files**

- Modify: `deploy.sh`, `.env.example`, `README.md`, `tests/daily-awareness-v2-integration.test.ts`, `tests/deploy-hardening.test.ts`

- [ ] **Step 1: Write failing assertions.** Require all MySQL variables in the example and deploy script; require idempotent `my_mysql` connection to `hermes-net`; verify an integration event reads a category-filtered daily table and persists source summaries.
- [ ] **Step 2: Run the tests and verify failure.**

```bash
node --import tsx --test tests/deploy-hardening.test.ts tests/daily-awareness-v2-integration.test.ts
```

- [ ] **Step 3: Update deployment.** Write the MySQL values to the remote env file, connect `my_mysql` to `hermes-net` idempotently, and document that the external writer owns `data_YYYYMMDD`.
- [ ] **Step 4: Verify and commit.**

```bash
node --import tsx --test tests/deploy-hardening.test.ts tests/daily-awareness-v2-integration.test.ts
bash -n deploy.sh
git diff --check
git add deploy.sh .env.example README.md tests/daily-awareness-v2-integration.test.ts tests/deploy-hardening.test.ts
git commit -m "docs: publish MySQL daily awareness deployment contract"
```

### Task 5: Full verification and release

- [ ] **Step 1: Run the focused Daily Awareness suite.**

```bash
DAILY_AWARENESS_INTERNAL_EVENT_KEY=test-secret node --import tsx --test \
  server/daily-awareness.download.test.ts server/daily-awareness.utils.test.ts \
  tests/daily-awareness-admin.test.ts tests/daily-awareness-generation.test.ts \
  tests/daily-awareness-internal-events.test.ts tests/daily-awareness-material-quality.test.ts \
  tests/daily-awareness-query.test.ts tests/daily-awareness-v2-integration.test.ts \
  tests/daily-awareness-v2-permissions.test.ts tests/daily-awareness-v2-schema.test.ts \
  tests/daily-awareness-worker.test.ts tests/frontend-daily-awareness-v2.test.ts \
  tests/daily-awareness-mysql-source.test.ts
```

- [ ] **Step 2: Run `npm run build`, frontend `npm run build`, `bash -n deploy.sh`, and `git diff --check`.**
- [ ] **Step 3: Review every requirement against the design: MySQL source, fixed category checkboxes, title-only scoring input, direct summary output, global top 50, retry/dead-letter, no replay overwrite, and deployment settings.**
- [ ] **Step 4: Deploy only after verification.** Run `bash deploy.sh`, verify health and invalid internal-event HTTP 400, then open the production management console and confirm the category checkboxes.
