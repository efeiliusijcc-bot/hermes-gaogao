# Planning-Stage Automatic Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real planning-stage automatic collection pipeline that discovers URLs through shared Tavily search, safely fetches and validates pages, lets users confirm layered results, and reuses coverage-aware sources in formal reports.

**Architecture:** Extract provider-neutral search discovery and source-quality services, keep `CrawlerService` limited to explicit URL fetching, and add `PlanningCollectionService` as the mode/query/discovery/validation/scoring orchestrator. Persist versioned diagnostics in existing Crawler JSONB fields, expose owner-scoped planning endpoints, and make formal report supplementation depend on uncovered gaps rather than total source count.

**Tech Stack:** NestJS, TypeScript, PostgreSQL JSONB, Vue 3 Composition API, existing `ResearchKeysService`, Node `fetch`, `tsx` tests, pnpm 9.15.9.

## Global Constraints

- Do not duplicate the Tavily client or expose API keys in logs.
- `CrawlerService` accepts explicit URLs only and never performs search discovery.
- Missing mode values normalize to `hybrid`.
- `effectiveMaxDepth` is always `0` in this release, regardless of client input.
- Maximum defaults: 8 queries, 5 results/query, 30 unique discovered URLs, 20 fetched URLs, 5 URLs/domain, 30,000 characters/page, 150 seconds/task.
- `uncertain + userConfirmed` remains uncertain; it never mutates into accepted.
- Rejected sources never enter formal report context.
- Existing manual URL collection and owner isolation must remain compatible.
- Work with the existing dirty worktree and do not overwrite unrelated changes in `server/hermes.service.ts`, `tests/crawler-report-integration.test.ts`, or daily-awareness files.

---

## File Structure

- Create `server/search-discovery.service.ts`: shared Tavily discovery, normalization, canonicalization, limits, telemetry.
- Create `server/source-quality.service.ts`: shared quality classification and credibility component scoring.
- Create `server/planning-collection.types.ts`: request/result/status/coverage/diagnostic contracts.
- Create `server/planning-collection.service.ts`: query, mode, filtering, fetching, validation, scoring, persistence orchestration.
- Create `server/planning-collection.controller.ts`: owner-scoped run/read/items/update/confirm/cancel endpoints.
- Modify `server/web-supplement.service.ts`: delegate search and quality work to shared services; add coverage-aware trigger input.
- Modify `server/crawler.service.ts`: expose explicit-seed fetch primitive, abort checks, scored metadata persistence, forced depth zero.
- Modify `server/crawler.types.ts`: compatible metadata and explicit-seed contracts.
- Modify `server/app.module.ts`: register new controller and services.
- Modify `server/reports.service.ts`: preserve confirmed planning states and supplement uncovered gaps only.
- Modify `b_k3ewYvsOEc1/src/lib/api.js`: planning collection API client.
- Modify `b_k3ewYvsOEc1/src/composables/useReportJobs.js`: collection run, grouped results, selection, confirmation, cancellation, payload context.
- Modify `b_k3ewYvsOEc1/src/components/DataCanvas.vue`: layered results UI, diagnostics, truthful mode/depth copy.
- Add the five required planning tests plus idempotency/cancellation and frontend-focused unit coverage where supported by the current frontend test stack.

---

### Task 1: Shared Search Discovery

**Files:**
- Create: `server/search-discovery.service.ts`
- Modify: `server/web-supplement.service.ts`
- Modify: `server/app.module.ts`
- Test: `tests/planning-auto-collection.test.ts`

**Interfaces:**
- Consumes: `ResearchKeysService.withKeyFailover('tavilyApiKey', callback)`.
- Produces: `SearchDiscoveryService.search(request): Promise<SearchDiscoveryResult>` and exported `canonicalizeDiscoveredUrl(url)`.

- [ ] **Step 1: Write the failing shared-search tests**

Add tests proving query limit, per-query result limit, canonical URL deduplication, diagnostics, and safe failure:

```ts
const discovery = new SearchDiscoveryService(fakeResearchKeys);
const result = await discovery.search({
  queries: [{ query: 'Neo Performance Materials Magnequench production update', directionId: 'company' }],
  language: 'en',
  maxResultsPerQuery: 5,
});
assert.equal(result.sources.length, 1);
assert.equal(result.sources[0].canonicalUrl, 'https://example.com/news');
assert.equal(result.sources[0].directionId, 'company');
assert.equal(result.requestCount, 1);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx tests/planning-auto-collection.test.ts`

Expected: FAIL because `server/search-discovery.service.ts` does not exist.

- [ ] **Step 3: Implement `SearchDiscoveryService`**

Implement the provider boundary and normalized result:

```ts
@Injectable()
export class SearchDiscoveryService {
  constructor(@Inject(ResearchKeysService) private readonly researchKeys: ResearchKeysService) {}

  async search(input: SearchDiscoveryRequest): Promise<SearchDiscoveryResult> {
    const queries = dedupeQueries(input.queries).slice(0, bound(input.maxQueries, 1, 8, 8));
    // Search concurrently, normalize Tavily fields, preserve directionId,
    // canonicalize, dedupe, limit to 30, and return per-query diagnostics.
  }
}
```

Move the Tavily `fetch` body from `WebSupplementService.searchQuery` into this service. Pass `include_raw_content: true`, enforce timeout, and keep `ResearchKeysService` failover.

- [ ] **Step 4: Delegate Web Supplement search**

Inject `SearchDiscoveryService` into `WebSupplementService`; convert its normalized results back to existing `WebSearchSource[]` so callers remain compatible. Remove the direct Tavily request from Web Supplement.

- [ ] **Step 5: Run focused and existing Web Supplement tests**

Run:

```bash
npx tsx tests/planning-auto-collection.test.ts
npx tsx tests/web-supplement-trigger.test.ts
npx tsx tests/web-source-entity-filter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/search-discovery.service.ts server/web-supplement.service.ts server/app.module.ts tests/planning-auto-collection.test.ts
git commit -m "feat: share Tavily search discovery"
```

---

### Task 2: Shared Source Quality and Explainable Scores

**Files:**
- Create: `server/source-quality.service.ts`
- Modify: `server/web-supplement.service.ts`
- Modify: `server/app.module.ts`
- Test: `tests/planning-collection-source-filter.test.ts`

**Interfaces:**
- Consumes: normalized source records and optional corroborating-domain count.
- Produces: `SourceQualityService.assess(source, context): SourceQualityAssessment` and compatibility export `assessSourceQuality`.

- [ ] **Step 1: Write failing classification and scoring tests**

Cover official, mainstream, research, ordinary, login, tag/search, empty-body, and nonconstant scores:

```ts
const official = quality.assess({
  title: 'Magnequench production update',
  url: 'https://www.neomaterials.com/news/update',
  contentText: longRelevantBody,
}, { corroboratingDomains: 2 });
assert.equal(official.status, 'accepted');
assert.ok(official.credibilityScore >= 85);
assert.notEqual(official.credibilityScore, 50);
assert.match(official.reason, /official|官方/i);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/planning-collection-source-filter.test.ts`

Expected: FAIL because `SourceQualityService` does not exist.

- [ ] **Step 3: Implement shared quality assessment**

Extract existing rules and calculate:

```ts
credibilityScore = round100(
  0.40 * sourceQualityScore +
  0.25 * officialDomainScore +
  0.20 * contentCompletenessScore +
  0.15 * corroborationScore
);
```

Return every component, tier, status, and reason. Keep a compatibility wrapper in `web-supplement.service.ts` rather than leaving duplicate logic.

- [ ] **Step 4: Run source and Web Supplement regressions**

Run:

```bash
npx tsx tests/planning-collection-source-filter.test.ts
npx tsx tests/web-source-entity-filter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/source-quality.service.ts server/web-supplement.service.ts server/app.module.ts tests/planning-collection-source-filter.test.ts
git commit -m "feat: share source quality assessment"
```

---

### Task 3: Explicit-Seed Crawler Primitive and Forced Depth Zero

**Files:**
- Modify: `server/crawler.types.ts`
- Modify: `server/crawler.service.ts`
- Test: `tests/crawler.test.ts`
- Test: `tests/planning-collection-mode.test.ts`

**Interfaces:**
- Produces: `CrawlerService.fetchSeedUrls(task, seeds, options): Promise<CrawlerFetchResult>`.
- `CrawlerFetchOptions` contains `signal?: AbortSignal`, `maxUrls`, and seed metadata; it contains no search/query generator.

- [ ] **Step 1: Add failing Crawler tests**

Test canonical seed dedupe, abort before next URL, forced depth zero, metadata preservation, and current SSRF behavior:

```ts
const result = await service.fetchSeedUrls(task, [
  { url: 'https://example.com/a', origin: 'manual_url' },
  { url: 'https://example.com/a#fragment', origin: 'tavily' },
], { maxUrls: 20 });
assert.equal(result.items.length, 1);
assert.equal(result.items[0].metadata.origin, 'manual_url');
assert.equal(result.task.crawlerPlan.effectiveMaxDepth, 0);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/crawler.test.ts`

Expected: FAIL because `fetchSeedUrls` and explicit seed types do not exist.

- [ ] **Step 3: Refactor Crawler without adding search behavior**

Make `runTask` build legacy explicit seeds and delegate to `fetchSeedUrls`. Expose URL safety validation for the orchestrator through a method that returns a structured rejection rather than leaking DNS details. Check `AbortSignal` before each URL and after fetch. Clamp and persist all task depths to zero.

- [ ] **Step 4: Persist supplied scores and metadata**

Change item insertion from fixed `50/50` to values supplied by the orchestrator, with null provisional scores permitted before validation. Legacy Crawler calls receive a deterministic basic score derived from content/URL quality, never an unconditional fixed pair.

- [ ] **Step 5: Run Crawler and mode tests**

Run:

```bash
npx tsx tests/crawler.test.ts
npx tsx tests/planning-collection-mode.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/crawler.types.ts server/crawler.service.ts tests/crawler.test.ts tests/planning-collection-mode.test.ts
git commit -m "refactor: keep crawler limited to explicit URLs"
```

---

### Task 4: Planning Query, Mode, Gap, and Summary Filtering Core

**Files:**
- Create: `server/planning-collection.types.ts`
- Create: `server/planning-collection.service.ts`
- Modify: `server/app.module.ts`
- Test: `tests/planning-auto-collection.test.ts`
- Test: `tests/planning-hybrid-collection.test.ts`
- Test: `tests/planning-collection-mode.test.ts`
- Test: `tests/planning-collection-source-filter.test.ts`

**Interfaces:**
- Produces: `executePlanningCollection(input): Promise<PlanningCollectionResult>`.
- Uses: `SearchDiscoveryService`, `CrawlerService`, `SourceQualityService`, `validateSourceEntityMatch`, and `buildRuleBasedEntityPolicy`.

- [ ] **Step 1: Add failing mode/query tests**

Cover all required cases: empty manual mode without Tavily, auto without URLs, hybrid merge/dedupe, direction queries, `site:` domain constraints, manual keywords, gap queries, lookback, and bilingual auto queries.

```ts
const result = await service.executePlanningCollection({
  ownerId: 'user-1', planningSessionId: 'plan-1', topic,
  mode: 'auto', directions: [{ id: 'official', enabled: true, queries: [query], targetDomains: [] }],
  manualUrls: [], manualDomains: [], manualKeywords: [], language: 'auto', maxDepth: 3,
});
assert.equal(search.calls.length, 1);
assert.equal(crawler.seeds[0].origin, 'tavily');
assert.equal(result.diagnostics.effectiveMaxDepth, 0);
```

- [ ] **Step 2: Run all four planning tests and verify RED**

Run:

```bash
npx tsx tests/planning-auto-collection.test.ts
npx tsx tests/planning-hybrid-collection.test.ts
npx tsx tests/planning-collection-mode.test.ts
npx tsx tests/planning-collection-source-filter.test.ts
```

Expected: FAIL because the planning orchestrator/types do not exist.

- [ ] **Step 3: Implement normalized input and real mode semantics**

Normalize empty mode to hybrid. Manual skips discovery. Auto ignores manual seeds for discovery input but crawls discovered URLs. Hybrid merges both. Enforce all global caps and five URLs/domain.

- [ ] **Step 4: Implement query and coverage-gap generation**

Build entity-qualified, deduplicated 4-8 query lists from priority-ordered directions, manual keywords, policy queries, and uncovered gaps. Reject broad phrases without a core entity or explicit limiter. Emit Chinese and English variants for `auto` where aliases permit.

- [ ] **Step 5: Implement discovery summary filtering**

Apply canonical URL, structured Crawler safety result, lookback only for known valid dates, language plausibility, confusion matches, and summary entity validation. Preserve `fetch_required` when evidence is incomplete rather than rejecting solely for a missing full name.

- [ ] **Step 6: Run and make the planning tests GREEN**

Run the four commands from Step 2. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/planning-collection.types.ts server/planning-collection.service.ts server/app.module.ts tests/planning-*.test.ts
git commit -m "feat: orchestrate planning source discovery"
```

---

### Task 5: Body Validation, Scoring, Persistence, and Layered Results

**Files:**
- Modify: `server/planning-collection.service.ts`
- Modify: `server/crawler.service.ts`
- Test: `tests/planning-collection-source-filter.test.ts`

**Interfaces:**
- Produces grouped `acceptedItems`, `uncertainItems`, `rejectedItems`, `failedUrls`, and complete diagnostics.

- [ ] **Step 1: Add failing body-validation tests**

Test confusion rejection before fetch, fetch-required promotion after body evidence, body rejection, meaningful scores, default selection thresholds, and explanatory metadata:

```ts
assert.equal(result.acceptedItems[0].metadata.validationStatus, 'accepted');
assert.ok(result.acceptedItems[0].relevanceScore >= 65);
assert.ok(result.acceptedItems[0].credibilityScore >= 60);
assert.equal(result.acceptedItems[0].metadata.selected, true);
assert.ok(result.acceptedItems[0].metadata.scoreReason.entityScore >= 0);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx tests/planning-collection-source-filter.test.ts`

Expected: FAIL on absent body status/score metadata.

- [ ] **Step 3: Implement body guard and quality assessment**

Run `validateSourceEntityMatch` and `SourceQualityService.assess` after fetch. Calculate the exact design formulas, then group accepted/uncertain/rejected. Compute corroboration from unique domains supporting the same entity/gap.

- [ ] **Step 4: Persist versioned item and task diagnostics**

Write origin, canonical URL, query, direction, snippet, publication state, discovery/body statuses, entity match, quality, score components, gaps, selection, and rejection reason to item metadata. Write all query/count/duration/safety/failure/coverage fields plus `effectiveMaxDepth: 0` to task plan metadata.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx tsx tests/planning-collection-source-filter.test.ts
npx tsx tests/crawler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/planning-collection.service.ts server/crawler.service.ts tests/planning-collection-source-filter.test.ts
git commit -m "feat: validate and score planning sources"
```

---

### Task 6: Owner-Scoped API, Idempotency, Selection, Confirmation, and Cancellation

**Files:**
- Create: `server/planning-collection.controller.ts`
- Modify: `server/planning-collection.service.ts`
- Modify: `server/app.module.ts`
- Test: `tests/planning-collection-mode.test.ts`
- Test: `tests/planning-collection-report-integration.test.ts`
- Test: `tests/owner-isolation.test.ts`

**Interfaces:**
- Exposes the six `/planning-collection` endpoints from the design.
- Produces persisted `planningCollectionStatus`, selected IDs, coverage, tasks, diagnostics.

- [ ] **Step 1: Add failing idempotency, cancellation, and owner tests**

Cover same idempotency key reuse, same active fingerprint reuse, new nonce rerun, cancellation during discovery/fetch, rejected selection denial, uncertain confirmation preservation, and cross-owner denial.

```ts
const updated = await service.updateItem(taskId, uncertainId, { selected: true, userConfirmed: true }, owner);
assert.equal(updated.metadata.validationStatus, 'uncertain');
assert.equal(updated.metadata.userConfirmed, true);
await assert.rejects(() => service.updateItem(taskId, rejectedId, { selected: true }, owner));
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx tsx tests/planning-collection-mode.test.ts
npx tsx tests/planning-collection-report-integration.test.ts
npx tsx tests/owner-isolation.test.ts
```

Expected: FAIL on absent endpoints/service methods.

- [ ] **Step 3: Implement idempotent run and active-task dedupe**

Persist the client idempotency key and server request fingerprint in task JSONB. Query owner-scoped active/recent tasks before creation. Return existing task/result for duplicates and permit rerun only with a new nonce/fingerprint.

- [ ] **Step 4: Implement cancellation registry and persisted cancellation**

Maintain an in-process `Map<taskId, AbortController>` for live work and persist `cancelRequestedAt`. Check persisted cancellation between phases so cancellation still works if no local controller exists. Never rewrite completed tasks as cancelled.

- [ ] **Step 5: Implement selection and confirmation rules**

Accepted items are user-toggleable, uncertain items require `userConfirmed=true`, and rejected items cannot be selected. Confirmation stores only accepted or user-confirmed uncertain IDs and computes final coverage from those sources.

- [ ] **Step 6: Add controller routes and permissions**

Use existing `CurrentUser` and `RequirePermissions` patterns with Crawler read/create/execute permissions. Do not expose internal owner IDs in request bodies.

- [ ] **Step 7: Verify GREEN and commit**

Run the commands from Step 2. Expected: PASS.

```bash
git add server/planning-collection.controller.ts server/planning-collection.service.ts server/app.module.ts tests/planning-collection-*.test.ts tests/owner-isolation.test.ts
git commit -m "feat: expose safe planning collection lifecycle"
```

---

### Task 7: Frontend API, State, and Truthful Controls

**Files:**
- Modify: `b_k3ewYvsOEc1/src/lib/api.js`
- Modify: `b_k3ewYvsOEc1/src/composables/useReportJobs.js`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Test: use the current frontend unit-test location if present; otherwise validate through build and browser in Task 10.

**Interfaces:**
- Adds `runPlanningCollection`, `getPlanningCollection`, `getPlanningCollectionItems`, `updatePlanningCollectionItem`, `confirmPlanningCollection`, and `cancelPlanningCollection`.

- [ ] **Step 1: Add failing API/state tests if the frontend test runner exists**

Assert that run sends idempotency key/run nonce, grouped results map into four tabs, uncertain confirmation retains status, and payload contains confirmation/coverage. If no frontend test runner exists, add pure exported normalization helpers to `useReportJobs.js` and test them through the repository's existing JS test convention.

- [ ] **Step 2: Replace the direct create/run Crawler planning calls**

Call `/planning-collection/run`, retain task/status/diagnostics, poll or refresh by task ID, support cancel, and preserve current error state. A rerun generates a new explicit run nonce; accidental duplicate button presses reuse the in-flight promise/idempotency key.

- [ ] **Step 3: Disable depth and update mode copy**

Hide or disable the maximum-depth control, force the submitted value to zero, and render `当前仅抓取目标页面`. Use the confirmed manual/auto/hybrid descriptions.

- [ ] **Step 4: Verify frontend build**

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add b_k3ewYvsOEc1/src/lib/api.js b_k3ewYvsOEc1/src/composables/useReportJobs.js b_k3ewYvsOEc1/src/components/DataCanvas.vue
git commit -m "feat: run planning collection from report planning"
```

---

### Task 8: Layered Planning Results UI and Confirmation

**Files:**
- Modify: `b_k3ewYvsOEc1/src/composables/useReportJobs.js`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Modify: `b_k3ewYvsOEc1/src/App.vue` only if prop/event wiring requires it.

**Interfaces:**
- Consumes grouped item API and diagnostics.
- Produces final confirmation state for report payload.

- [ ] **Step 1: Implement stable result metrics and tabs**

Render query, discovery, fetched, recommended, uncertain, filtered, failed, and safety counts. Keep tab dimensions stable and show empty states specific to missing queries, no hits, all filtered, or fetch failure.

- [ ] **Step 2: Implement cards and selection rules**

Cards display all specified source/entity/score/body fields. Accepted items over thresholds default selected. Uncertain items show the confirmation warning and call PATCH with `userConfirmed=true`. Rejected items use disabled selection.

- [ ] **Step 3: Implement confirmation and cancellation controls**

Next-step confirmation calls the backend before report creation. Cancel aborts active planning collection and keeps partial diagnostics visible. Avoid nested cards and preserve existing report-planning layout conventions.

- [ ] **Step 4: Run frontend build**

Run: `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`

Expected: PASS without overflow/template warnings.

- [ ] **Step 5: Commit**

```bash
git add b_k3ewYvsOEc1/src/composables/useReportJobs.js b_k3ewYvsOEc1/src/components/DataCanvas.vue b_k3ewYvsOEc1/src/App.vue
git commit -m "feat: review planning collection results"
```

---

### Task 9: Formal Report Reuse and Coverage-Aware Supplement

**Files:**
- Modify: `server/reports.service.ts`
- Modify: `server/web-supplement.service.ts`
- Modify carefully: `server/hermes.service.ts` only if prompt requirements need the new coverage fields; preserve current unrelated user changes.
- Modify carefully: `tests/crawler-report-integration.test.ts`
- Test: `tests/planning-collection-report-integration.test.ts`
- Test: `tests/web-supplement-trigger.test.ts`

**Interfaces:**
- Consumes confirmed selected sources and `PlanningCoverage`.
- Produces report context with accepted plus user-confirmed uncertain sources, their original statuses, and uncovered-gap-only supplement queries.

- [ ] **Step 1: Add failing report integration tests**

Cover user deselection exclusion, rejected/ordinary uncertain exclusion, user-confirmed uncertain inclusion with retained status, full coverage skip, partial coverage queries only for uncovered gaps, topic/entity change invalidation, and owner isolation.

```ts
assert.equal(nextContext.crawlerSourceContext.items.some((item) => item.validationStatus === 'rejected'), false);
assert.deepEqual(supplement.calls[0].queries, uncoveredGap.queries);
assert.equal(confirmedUncertain.validationStatus, 'uncertain');
assert.equal(confirmedUncertain.userConfirmed, true);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx tsx tests/planning-collection-report-integration.test.ts
npx tsx tests/web-supplement-trigger.test.ts
npx tsx tests/crawler-report-integration.test.ts
```

Expected: FAIL on missing coverage-aware behavior.

- [ ] **Step 3: Enrich formal payload from confirmed planning data**

Reload selected owner-scoped items, re-run entity validation, retain uncertain/userConfirmed state, exclude rejected and unconfirmed uncertain items, and write task/coverage/diagnostic summaries into known context.

- [ ] **Step 4: Make supplement decision coverage-aware**

Extend trigger input with planning status and coverage. Full required-gap coverage skips Web Supplement/Crawler. Partial coverage constructs queries only from uncovered gaps. Selected count remains telemetry only.

- [ ] **Step 5: Keep Hermes prompt aligned**

If required, update the prompt rule to say planning sources are retained and only uncovered gaps may invoke research collection. Do not disturb unrelated pending edits in `server/hermes.service.ts`.

- [ ] **Step 6: Verify GREEN and commit**

Run the commands from Step 2. Expected: PASS.

```bash
git add server/reports.service.ts server/web-supplement.service.ts server/hermes.service.ts tests/planning-collection-report-integration.test.ts tests/web-supplement-trigger.test.ts tests/crawler-report-integration.test.ts
git commit -m "feat: reuse planning coverage in reports"
```

---

### Task 10: Completion Audit, Regression, Build, and Browser Verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run all required new tests**

```bash
npx tsx tests/planning-auto-collection.test.ts
npx tsx tests/planning-hybrid-collection.test.ts
npx tsx tests/planning-collection-mode.test.ts
npx tsx tests/planning-collection-source-filter.test.ts
npx tsx tests/planning-collection-report-integration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the specified regression suite**

```bash
npx tsx tests/crawler.test.ts
npx tsx tests/crawler-report-integration.test.ts
npx tsx tests/web-supplement-trigger.test.ts
npx tsx tests/web-source-entity-filter.test.ts
npx tsx tests/context-multi-source-filter.test.ts
npx tsx tests/owner-isolation.test.ts
npx tsx tests/account-permissions.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build backend and frontend**

```bash
npx pnpm@9.15.9 build
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run a live task when Tavily credentials are available**

Create an auto-mode planning task with no manual URL and a precise entity query.
Verify it discovers at least one URL or returns a specific provider/no-results
diagnostic; verify no API key appears in logs. Verify a repeated idempotency key does
not create another task and cancellation stops a separate long-running task.

- [ ] **Step 5: Browser-check desktop and mobile planning UI**

Start the development server, open the planning page, and inspect screenshots at a
desktop viewport and a mobile viewport. Verify the four tabs, metrics, score text,
uncertain warning, rejected disabled state, specific empty states, cancel state,
`当前仅抓取目标页面`, no overlap, and no horizontal overflow.

- [ ] **Step 6: Audit every design requirement against evidence**

Map each requirement in
`docs/superpowers/specs/2026-07-13-planning-auto-collection-design.md` to a passing
test, build output, API response, persisted row/metadata, or browser screenshot. Any
missing or indirect evidence remains incomplete and must be fixed before completion.

- [ ] **Step 7: Commit verification fixes, if any**

Inspect `git diff --name-only`, stage only the planning-collection files changed to
fix failed verification, confirm the staged diff with `git diff --cached --check`,
then commit with `git commit -m "fix: complete planning collection verification"`.
Do not stage the pre-existing daily-awareness or unrelated Hermes changes.
