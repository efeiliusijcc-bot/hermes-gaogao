# Web Auto-Supplement Production Validation

## Scope

This record validates the completed Web auto-supplement loop without changing entity-policy or source-entity-guard rules. Live network checks are intentionally not part of default CI. Set `RUN_LIVE_RETRIEVAL_TESTS=true` only after Tavily and a non-personal validation account are configured.

## Validation Run

- Date: 2026-07-10
- API instance: local Nest service on port 3101
- Tavily public endpoint: reachable
- Tavily credential: configured in the protected `ResearchKeysService` store (value omitted)
- Validation account: unavailable; the local default credentials were rejected and no further password attempts were made
- Database/vector and Hermes checks: not executed through protected API because no bearer token was available
- Output directory: created and writable in the configured local environment

## Live Acceptance Status

Live Tavily validation was run through `scripts/run-live-retrieval-validation.ts` with `RUN_LIVE_RETRIEVAL_TESTS=true`. It used the same query builder, Tavily raw-content response, entity guard, quality classification, and cross-channel dedupe function as the Web supplement service. No API key, source body, private content, or access token is recorded here.

The following eight scenarios were exercised; the final report-job/API artifact checks remain queued because a dedicated validation account/token is still required:

1. Magnequench / NEO production progress, rejecting Micron.
2. CATL European plant development.
3. Same-name person plus institution.
4. Poland border incident, rejecting US/Mexico border material.
5. Arm Holdings, rejecting military/army material.
6. Named policy with publisher, region, and time window.
7. European rare-earth permanent-magnet expansion and risk, without one core entity.
8. A topic with at least three accepted database sources, verifying no Tavily trigger.

For every live job, inspect `database/entity_policy.json`, database source artifacts, `research/web_sources.json`, `research/web_supplement_diagnostics.json`, crawler diagnostics, `context.json`, `references/report_references.json`, generated Markdown, and the report event log.

## Metrics Contract

`context.json.sourceDiagnostics.supplement.retrievalMetrics` now records database candidate/acceptance counts, Web query/search/fetch counts and rates, crawler attempts, cross-channel deduplication totals, source-quality/domain totals, and stage durations. Query diagnostics contain query text, result count, duration, and a bounded error message only.

Configured limits are environment-controlled: 4-10 queries (default 8), 5-10 candidates/query (default 8), 30 unique URLs, 20 full-content validations, 10 crawler fallbacks, and one retry. The total supplement timeout configuration is also recorded (90-180 seconds, default 120 seconds) for the next live-run timeout audit. No key or source body is written to metrics.

## Results

| Metric | Result |
| --- | --- |
| Live scenarios run | 8 (7 Tavily-triggered, 1 database-sufficient negative control) |
| Tavily requests | 48: 41 initial validation queries and 7 Arm quality-regression queries |
| Initial Web candidates | 196 unique candidates after per-scenario URL dedupe |
| Summary entity accepted | 36 |
| Initial body/quality accepted | 21; 20 after the Arm quality correction |
| Database-sufficient trigger | Correctly not triggered at 3 accepted database sources |
| Deduplication | 0 exact duplicates removed in this sample; duplicate URLs were already collapsed before guard evaluation |
| Final reference coverage | Not available: full report jobs require authenticated API access |
| Initial live elapsed time | 60.96 seconds across seven triggered scenarios; requests executed concurrently inside each scenario |

| Scenario | Queries | Candidates | Summary accepted | Content accepted after quality | Rejected/uncertain observation |
| --- | ---: | ---: | ---: | ---: | --- |
| Magnequench / NEO | 8 | 30 | 7 | 4 | One Tavily timeout; no Micron accepted |
| CATL Europe | 5 | 30 | 15 | 11 | One rejected; quality mix needs report-level corroboration |
| Li Qiang / State Council | 5 | 30 | 2 | 2 | Same-name risk remained mostly uncertain |
| Poland border | 2 | 16 | 5 | 1 | No US/Mexico border accepted |
| Arm Holdings | 7 | 30 | 5 | 0 | Army/military candidates rejected; TradingView downgraded to uncertain |
| EU CRMA | 6 | 30 | 2 | 2 | European Commission source retained |
| Europe magnets (broad) | 8 | 30 | 0 | 0 | Correctly fails closed; entity policy is too specific for broad-topic recall |
| Database sufficient | 0 | 0 | 0 | 0 | Correctly no Web trigger |

## Findings And Next Run Criteria

1. The app previously failed to boot because `ReportsService` and `DraftAssistantService` relied on missing runtime constructor metadata. Explicit Nest injection tokens now allow the validation instance to start.
2. Production startup now fails if `NODE_ENV=production` has no `JWT_SECRET`; development continues to use the existing local configuration.
3. A real quality false positive was found: TradingView could be classified as industry media when its body mentioned semiconductors. It is now `uncertain`, alongside other trading/stock-commentary sites.
4. The broad Europe-magnets scenario is a measured false-negative for the current explicit-entity policy. Keep it fail-closed for now; the next change, if desired, should model an explicit broad-topic mode rather than weaken entity matching globally.
5. Full report-job artifacts, crawler fallback, final citations, and DataCanvas API rendering remain blocked only by the missing dedicated validation account/token. Do not use an end-user account for automated acceptance.
