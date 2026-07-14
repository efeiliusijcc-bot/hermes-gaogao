# Final Fix: Report Sources and References

## Scope

The final review fixes are limited to `ReportsService` source/reference behavior
and source/reference-focused tests. Retrieval adapters were not edited, and no
deployment or cloud action was performed.

## Behavior

1. Only entries read from `evidence_cards` receive unconditional evidence
   eligibility. `key_findings` and `verification_needed` are regular research
   sources and must pass the existing credibility, tier, or accepted-quality
   gates before they can appear in the source API.
2. Final report reference reconstruction reads the normalized research pool
   independently of the display-only high-value filter, 300 eligible-item
   bound, and 50-item output cap. Reference URLs are matched with tracking
   parameters removed and retained query parameters sorted. The matched source
   keeps its original HTTP(S) URL, and the existing version-2 reference
   artifact write/read flow remains unchanged.
3. Research source normalization rejects non-HTTP(S) URLs before API output.
   Canonical URLs sort retained query parameters for deterministic dedupe while
   display items preserve the original accepted HTTP(S) URL.

## TDD Evidence

The strengthened live-source test was applied to the committed baseline in a
detached worktree. It failed first because a low-value `key_findings` item was
included. After isolating that behavior, it failed because non-HTTP(S) URLs
were included, then failed because reordered retained query parameters produced
two items instead of one.

The active reconstruction regression placed the cited source at raw research
index 320. It failed with `matchStatus: raw_only` because reconstruction still
used a 300-item slice. Removing that display-derived bound changed the result
to `matched`; the test also verifies artifact persistence and restoration.

## Verification

- `npx tsx tests/report-live-tool-search-sources.test.ts`
- `npx tsx tests/report-source-artifact-persistence.test.ts`
- `npx tsx tests/report-reference-section-boundary.test.ts`
- `npx tsx tests/crawler-report-integration.test.ts`
- `npx tsx tests/owner-isolation.test.ts`
- `npm run build`
- `git diff --check`

All commands completed successfully.
