# Planning-Stage Automatic Collection Design

## 1. Goal

Turn planning-stage collection into a real, bounded research pipeline:

```text
planning queries
  -> Tavily URL discovery
  -> URL safety and search-summary entity checks
  -> controlled page fetch
  -> body entity and source-quality checks
  -> deduplication and explainable scoring
  -> user selection and confirmation
  -> reuse in formal report generation
```

The implementation must preserve the existing manual URL workflow, must not make
`CrawlerService` responsible for web search, and must not repeat planning-stage
searches during formal report generation when confirmed coverage is sufficient.

This release fixes `effectiveMaxDepth` to `0`. The UI disables or hides the depth
control and states `当前仅抓取目标页面`; the backend ignores any supplied positive
depth and persists `effectiveMaxDepth: 0` in diagnostics.

## 2. Confirmed Architecture

### 2.1 `SearchDiscoveryService`

`server/search-discovery.service.ts` owns generic Tavily discovery. It depends on
`ResearchKeysService` for key failover and exposes a provider-neutral interface:

```ts
interface SearchDiscoveryRequest {
  queries: SearchDiscoveryQuery[];
  language: 'zh' | 'en' | 'auto';
  maxQueries?: number;
  maxResultsPerQuery?: number;
  maxUniqueUrls?: number;
  signal?: AbortSignal;
}

interface SearchDiscoveryResult {
  sources: DiscoveredSource[];
  queryDiagnostics: SearchQueryDiagnostic[];
  requestCount: number;
  durationMs: number;
}
```

It provides query limiting, Tavily request timeout, one retry through the existing
key-failover mechanism, canonical URL normalization, cross-query deduplication,
result normalization, and safe diagnostic errors. It never logs keys, tokens,
cookies, or full fetched bodies.

`WebSupplementService` calls this service instead of issuing its own Tavily HTTP
requests. The existing Web Supplement behavior and public result types remain
compatible.

### 2.2 `SourceQualityService`

`server/source-quality.service.ts` owns source classification and quality scoring.
It extracts the current `assessSourceQuality` logic from Web Supplement and extends
the result with explainable components:

```ts
interface SourceQualityAssessment {
  status: 'accepted' | 'uncertain' | 'rejected';
  tier: 'official' | 'mainstream' | 'research' | 'industry' | 'ordinary' | 'invalid';
  sourceQualityScore: number;
  officialDomainScore: number;
  contentCompletenessScore: number;
  corroborationScore: number;
  credibilityScore: number;
  reason: string;
}
```

A compatibility function remains exported from `web-supplement.service.ts` if
existing callers or tests import it there.

### 2.3 `CrawlerService`

`CrawlerService` remains a pure controlled fetcher. It receives explicit seed URLs,
applies SSRF/private-network checks, fetches supported public text pages, extracts
title and text, and persists raw collection items. It does not generate queries or
call Tavily.

The service gains a public orchestration-safe method that accepts explicit seeds and
an abort signal. Existing `runTask` delegates to the same method, preserving current
Crawler endpoints. Cancellation is checked before each URL and after each fetch.

### 2.4 `PlanningCollectionService`

`server/planning-collection.service.ts` is the only planning pipeline orchestrator.
Its `executePlanningCollection(input)` method:

1. Normalizes the request and enforces `effectiveMaxDepth = 0`.
2. Resolves or builds an `EntityPolicy`.
3. Builds coverage gaps and bounded queries.
4. Applies mode semantics.
5. Calls `SearchDiscoveryService` for `auto` and `hybrid` modes.
6. Runs URL, time, language, confusion, and summary entity checks.
7. Merges accepted/fetch-required discovery URLs with manual seeds.
8. Calls `CrawlerService` with explicit deduplicated URLs.
9. Revalidates fetched bodies with `validateSourceEntityMatch`.
10. Calls `SourceQualityService` and calculates final scores.
11. Persists task diagnostics and item metadata.
12. Returns accepted, uncertain, rejected, and failed groups.

It never changes `uncertain` into `accepted`. A user-confirmed uncertain source is
stored as `{ validationStatus: 'uncertain', userConfirmed: true }`.

## 3. Mode Semantics

### `manual`

Uses only `manualUrls`, `manualDomains`, and enabled
`directions[].targetDomains`. It does not call Tavily. With no manual seeds it
completes with a specific `missing_manual_seeds` diagnostic rather than a generic
zero-result message.

### `auto`

Uses enabled direction queries, manual keywords, `EntityPolicy.searchQueries`, and
gap-generated queries. It does not require user-provided URLs. Domains supplied on
directions constrain matching queries through `site:domain` queries.

### `hybrid`

Combines all manual seeds with automatic discovery. Canonical URLs are deduplicated
before crawling, so the same page discovered through multiple inputs is fetched
once. Missing mode values normalize to `hybrid` for backward compatibility.

## 4. Query Generation and Gaps

Queries are collected in this priority order:

1. Enabled `directions[].queries`, ordered by numeric priority.
2. `manualKeywords` converted into entity-qualified queries.
3. `entityPolicy.searchQueries`.
4. Gap queries generated from selected report sections, verification-needed items,
   unsupported sections, `topicTerms`, and `actionTerms`.

Every automatic query must contain a full core entity or an explicit limiting
condition such as `site:` plus a core-entity alias. Short ambiguous aliases and
broad industry-only phrases are discarded. `language=auto` emits both Chinese and
English variants when corresponding aliases exist. The final task uses 4-8 unique
queries, subject to available valid input.

Each gap has this stable shape:

```ts
interface PlanningCoverageGap {
  gapId: string;
  description: string;
  queries: string[];
  requiredSourceTypes: string[];
  acceptedSourceIds: string[];
  acceptedCount: number;
  officialCount: number;
  status: 'uncovered' | 'partial' | 'covered';
}
```

A gap is covered by at least two accepted high-quality sources, or at least one
accepted official source. `planningCoverage` records covered and uncovered gap IDs,
not just a global source count.

## 5. Discovery Filtering

Every Tavily result is normalized to:

```ts
interface DiscoveredSource {
  query: string;
  title: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  snippet: string;
  rawContent: string;
  publishedAt: string | null;
  publishedAtUnknown: boolean;
  sourceType: string;
  searchScore: number;
  directionId: string | null;
}
```

Filtering order is canonical URL deduplication, HTTP/HTTPS validation, Crawler URL
safety validation, lookback filtering when a valid publication time is available,
language plausibility, confusion detection, and search-summary entity validation.

Statuses are:

- `search_accepted`: summary clearly matches a core entity and topic.
- `fetch_required`: title, domain, URL, or weak summary evidence justifies a bounded
  body fetch; absence of a full entity in the snippet alone is not rejection.
- `search_rejected`: unsafe URL, explicit confusion, valid out-of-range publication
  time, invalid page type, or clear irrelevance.

Unknown publication times remain eligible with `publishedAtUnknown=true` and a
reduced freshness component. Language mismatch reduces confidence but only becomes
rejection when the configured language is explicit and the content has no entity or
topic evidence.

## 6. Body Validation and Scoring

Fetched content is checked again with `validateSourceEntityMatch(item, entityPolicy)`
and `SourceQualityService.assess(item)`. Invalid, login, search, tag, aggregation,
empty-body, confusion, and wrong-entity pages are rejected.

Scores are integers from 0 to 100:

```text
relevanceScore = 100 * (
  0.45 * entityScore +
  0.30 * topicScore +
  0.15 * searchScore +
  0.10 * freshnessScore
)

credibilityScore = 100 * (
  0.40 * sourceQualityScore +
  0.25 * officialDomainScore +
  0.20 * contentCompletenessScore +
  0.15 * corroborationScore
)
```

The persisted `scoreReason` lists each component. Corroboration is based only on
other unique accepted domains supporting the same gap/entity; it defaults low when
there is no corroboration. New items are never assigned a fixed `50/50` pair.

Final validation status is:

- `accepted`: entity accepted, quality not rejected, relevance at least 65, and
  credibility at least 60.
- `uncertain`: useful but incomplete entity/quality evidence.
- `rejected`: entity rejected, quality rejected, unsafe, invalid, or unusable body.

## 7. Persistence

Existing `crawler_tasks` and `crawler_items` tables remain authoritative. Task
`crawler_plan` and item `metadata` JSONB fields gain versioned planning fields.

Task metadata includes mode, effective queries, policy summary, coverage gaps,
discovery/crawl/validation counts, failures, safety blocks, durations, Tavily
request count, selection count, idempotency key, cancel request, and
`effectiveMaxDepth: 0`.

Item metadata includes origin, query, direction, canonical URL, snippet, publication
state, discovery status, validation status, `userConfirmed`, entity match, quality
assessment, score components, score reason, gap IDs, selection state, and rejection
reason.

## 8. Idempotency, Duplicate Submission, and Cancellation

The client sends an idempotency key derived from the planning session and an
explicit run nonce. The server also computes a request fingerprint from owner,
planning session, normalized topic, mode, queries, and seeds.

- A duplicate request with the same owner and idempotency key returns the existing
  task.
- A concurrent request with the same fingerprint while a task is active returns the
  active task instead of starting another run.
- A new explicit run nonce permits a rerun after inputs change.
- Owner checks apply to read, update, confirm, and cancel operations.

Cancellation uses `POST /planning-collection/:taskId/cancel`. It persists
`cancelRequestedAt`, aborts in-flight discovery/fetch through `AbortController`,
stops before starting the next URL, and ends in `cancelled`. Completed tasks are
unchanged by late cancellation requests.

Task states are `pending`, `discovering`, `crawling`, `validating`, `completed`,
`partial`, `failed`, and `cancelled`.

## 9. HTTP API

- `POST /planning-collection/run`: idempotently create and execute a full task.
- `GET /planning-collection/:taskId`: return owner-scoped state and diagnostics.
- `GET /planning-collection/:taskId/items`: return grouped/paged item results.
- `PATCH /planning-collection/:taskId/items/:itemId`: update selection or
  `userConfirmed` for uncertain items; rejected items cannot be selected.
- `POST /planning-collection/:taskId/confirm`: persist final selected IDs, coverage,
  task references, and confirmation status.
- `POST /planning-collection/:taskId/cancel`: request cancellation.

The existing Crawler APIs stay available for compatibility.

## 10. Frontend

The planning page calls the new run endpoint and displays live stage text. The mode
copy is truthful: manual uses user targets only, auto discovers public pages, and
hybrid combines both.

The result area has stable tabs:

- 推荐采用
- 待核验
- 已过滤
- 抓取失败

Summary metrics include query count, discovered candidates, fetched bodies,
recommended items, uncertain items, filtered items, failed URLs, and safety blocks.
Cards show title, publisher/domain, publication state, source type, summary,
direction, matched entities, relevance, credibility, original URL, expanded body,
and validation reason.

Accepted items meeting both thresholds are selected by default. Uncertain items are
unselected and display a warning; manual selection writes `userConfirmed=true` but
retains `validationStatus='uncertain'`. Rejected items cannot be selected.

Zero-result copy distinguishes missing queries, no search hits, all candidates
filtered, and fetch failures, and exposes actions to adjust directions, edit queries,
add links, inspect filtered results, or proceed without public material.

The maximum-depth control is disabled or hidden. The page displays
`当前仅抓取目标页面`.

## 11. Formal Report Integration

Confirmation writes this structure into planning context:

```ts
{
  planningCollectionStatus: 'confirmed',
  selectedCrawlerItemIds: string[],
  selectedSources: PlanningSelectedSource[],
  collectionTasks: PlanningCollectionTaskSummary[],
  planningCoverage: PlanningCoverage,
  diagnostics: PlanningCollectionDiagnostics
}
```

Formal report enrichment reloads owner-scoped selected items and re-runs entity
validation. It admits accepted items and uncertain items only when
`userConfirmed=true`; uncertain items retain their validation status in context.
Rejected items never enter report context.

Web Supplement and research-stage Crawler decisions use `planningCoverage`:

- All required gaps covered: skip repeat Tavily and Crawler.
- Uncovered gaps remain: keep planning sources and search only the uncovered gap
  queries.
- Topic/core entities changed: invalidate affected gap coverage and search only the
  affected gaps.
- User explicitly allows further collection: search uncovered gaps only.

A global selected-source threshold is diagnostic only and never the sole skip rule.

## 12. Limits and Diagnostics

Defaults are eight queries, five results per query, thirty unique discovered URLs,
twenty fetched URLs, five URLs per domain, one Tavily retry through key failover,
thirty thousand fetched characters per page, and a 150-second task deadline.

Diagnostics record query/result counts, canonical deduplication, summary statuses,
fetch successes/failures, body statuses, safety blocks, per-stage durations, Tavily
request count, coverage, and the concrete zero-result reason. Sensitive credentials
and full restricted content are excluded.

## 13. Test and Verification Strategy

Tests cover manual/auto/hybrid behavior, direction queries and domain constraints,
manual keywords, gap queries, lookback, bilingual auto queries, confusion rejection,
fetch-required fallback, body acceptance, nonconstant scoring, confirmation,
coverage-aware supplement decisions, uncertain preservation, rejected exclusion,
owner isolation, idempotency, duplicate active submissions, cancellation, and forced
depth zero.

Verification includes all new planning collection tests, existing Crawler/report/Web
Supplement/entity/owner/permission regressions, backend build, frontend build, and a
browser check of the planning result tabs, disabled depth control, zero-result copy,
and responsive layout.

## 14. Out of Scope

This release does not implement recursive or whole-site crawling, authenticated
content access, strict publication-time guarantees for pages without dates, or a new
search provider. `maxDepth=1` remains future work and is not advertised as supported.
