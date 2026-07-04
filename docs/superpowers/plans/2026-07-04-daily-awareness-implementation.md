# Daily Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first synchronous “每日动态感知” module, reusing the existing PG/pgvector source library and adding a frontend page, backend APIs, SQL tables, and Draft Assistant import entry.

**Architecture:** Add a focused Daily Awareness backend controller/service while keeping report-jobs, chat/QA, Draft Assistant core, and pgvector schema untouched. Reuse `VectorSourceService` for source material reads and `createAuthPool()` for the two new business tables. Add a new Vue page and a third home entry while the existing QA card is renamed and still routes to current `DataCanvas` QA mode.

**Tech Stack:** NestJS-style TypeScript backend, PostgreSQL JSONB tables, OpenAI-compatible SDK, Vue 3 frontend, Vite build, existing Auth/Roles guards.

---

### Task 1: Add Daily Awareness Pure Logic Tests And Helpers

**Files:**
- Create: `server/daily-awareness.types.ts`
- Create: `server/daily-awareness.utils.ts`
- Create: `server/daily-awareness.utils.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/daily-awareness.utils.test.ts` with tests for title normalization, material dedupe, candidate aggregation, score sorting, and JSON extraction.

- [ ] **Step 2: Run tests and verify red**

Run: `npx tsx --test server/daily-awareness.utils.test.ts`

Expected: fails because `daily-awareness.utils.ts` does not exist.

- [ ] **Step 3: Implement minimal helper functions**

Create `daily-awareness.types.ts` and `daily-awareness.utils.ts` with exported functions:
- `normalizeEventTitle()`
- `dedupeMaterials()`
- `buildEventCandidates()`
- `rankDailyEvents()`
- `extractJsonObject()`

- [ ] **Step 4: Run tests and verify green**

Run: `npx tsx --test server/daily-awareness.utils.test.ts`

Expected: tests pass.

### Task 2: Add SQL Initialization

**Files:**
- Create: `scripts/init-daily-awareness.sql`

- [ ] **Step 1: Add SQL file**

Create the exact `daily_briefs` and `daily_brief_events` schema from the design spec, including `pgcrypto` and indexes.

- [ ] **Step 2: Validate SQL text**

Run: `rg -n "daily_briefs|daily_brief_events|pgcrypto" scripts/init-daily-awareness.sql`

Expected: both tables and extension are present.

### Task 3: Extend VectorSourceService

**Files:**
- Modify: `server/vector-source.service.ts`

- [ ] **Step 1: Add public types**

Export `ListMaterialsByDateInput` and `VectorMaterialByDate`.

- [ ] **Step 2: Add `listMaterialsByDate()`**

Implement a public method that reuses `ensureReady()`, `discoverNewsColumns()`, and `getPool()`, reads from `ACTIVE_VECTOR_CONFIG.sourceTable`, applies date/keyword/category/region filtering with parameterized SQL, truncates content to 800 chars, caps limit at 3000, and performs basic duplicate filtering.

- [ ] **Step 3: Run backend type build**

Run: `npx pnpm@9.15.9 build`

Expected: TypeScript build passes or reveals compile errors to fix.

### Task 4: Add Daily Awareness Backend API

**Files:**
- Create: `server/daily-awareness.service.ts`
- Create: `server/daily-awareness.controller.ts`
- Modify: `server/app.module.ts`

- [ ] **Step 1: Implement service skeleton**

Create `DailyAwarenessService` with methods:
- `generate(input, user)`
- `listBriefs(query, user)`
- `getBrief(briefId, user)`
- `listEvents(briefId, query, user)`
- `importEventToDraft(itemId, user)`

- [ ] **Step 2: Implement synchronous generate flow**

Use `VectorSourceService.listMaterialsByDate()`, helper dedupe/aggregation, LLM batch classification/scoring, Top N ranking, summary generation, and inserts into `daily_briefs` / `daily_brief_events`.

- [ ] **Step 3: Implement query and import logic**

Use owner/admin permission checks. Insert Draft Assistant `events` and `event_sources` for import without changing Draft Assistant core service.

- [ ] **Step 4: Implement controller routes**

Register:
- `POST /api/daily-awareness/generate`
- `GET /api/daily-awareness/briefs`
- `GET /api/daily-awareness/briefs/:briefId`
- `GET /api/daily-awareness/briefs/:briefId/events`
- `POST /api/daily-awareness/events/:itemId/import-draft`

- [ ] **Step 5: Register module**

Add controller and provider to `server/app.module.ts`.

- [ ] **Step 6: Run backend build**

Run: `npx pnpm@9.15.9 build`

Expected: build passes.

### Task 5: Add Frontend API Methods

**Files:**
- Modify: `b_k3ewYvsOEc1/src/lib/api.js`

- [ ] **Step 1: Add request wrappers**

Add:
- `generateDailyBrief(payload)`
- `getDailyBriefs(params)`
- `getDailyBrief(briefId)`
- `getDailyBriefEvents(briefId, params)`
- `importDailyEventToDraft(itemId)`

- [ ] **Step 2: Run frontend build**

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: build passes.

### Task 6: Add DailyAwareness Vue Page

**Files:**
- Create: `b_k3ewYvsOEc1/src/components/DailyAwareness.vue`

- [ ] **Step 1: Build page shell**

Add top title/subtitle/back button, filters, loading/error states, overview cards, category filter, event cards, and history list.

- [ ] **Step 2: Implement API interactions**

Load brief history on mount, call generate endpoint synchronously, open brief detail, filter events by category, and import events to Draft Assistant.

- [ ] **Step 3: Implement permission UX**

Disable generate and import for viewer, with clear helper text.

- [ ] **Step 4: Run frontend build**

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: build passes.

### Task 7: Adjust Home Entries And App Routing

**Files:**
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Modify: `b_k3ewYvsOEc1/src/App.vue`

- [ ] **Step 1: Rename QA entry**

Change the existing QA card and QA empty state text from “热点事件动态感知” to “QA问答”, with QA-focused description and tags.

- [ ] **Step 2: Add Daily Awareness entry**

Add a third feature card for “每日动态感知” and emit a distinct action/event when selected.

- [ ] **Step 3: Route to DailyAwareness**

Import and render `DailyAwareness.vue` from `App.vue`, preserving existing QA and report behavior.

- [ ] **Step 4: Run frontend build**

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: build passes.

### Task 8: End-To-End Verification And Memory

**Files:**
- Add memory note under `/Users/a15070743048/.codex/memories/extensions/ad_hoc/notes/`

- [ ] **Step 1: Run final builds**

Run:
- `npx pnpm@9.15.9 build`
- `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`
- `git diff --check`

- [ ] **Step 2: Chrome/manual verification**

Use Chrome to verify homepage entries and Daily Awareness page shell. If database SQL has not been applied, verify the page shows backend errors cleanly rather than crashing.

- [ ] **Step 3: Write project memory**

Add a concise note describing files changed, routes added, SQL script, and verification results.

- [ ] **Step 4: Commit**

Commit implementation on `codex/daily-awareness`.
