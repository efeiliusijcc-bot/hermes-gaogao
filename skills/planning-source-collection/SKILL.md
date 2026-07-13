---
name: planning-source-collection
description: Collect and verify additional public sources only as an internal step of an enabled Deep Report task. Require workflow=deep_report, deepReportEnabled=true, stage=source_collection, a current planningSessionId, and a topic. Never trigger for ordinary reports, chat, search, QA, or writing.
---

# Deep Report Source Collection

This Skill is an internal `report-agent` step. It is not a standalone crawler or a general search Skill.

## Mandatory Availability Gate

Before using any research capability, validate all fields:

```json
{
  "workflow": "deep_report",
  "deepReportEnabled": true,
  "stage": "source_collection",
  "planningSessionId": "current report job id",
  "topic": "non-empty report topic"
}
```

If any field is missing or invalid, do not search or fetch. Return exactly:

```json
{
  "status": "not_available",
  "reason": "This skill is only available after Deep Report is enabled."
}
```

Never infer Deep Report mode from wording alone. Trust only the structured context supplied by the current report task.

## Allowed Runtime

- Run only inside the existing Hermes `report-agent` task.
- Use the preinstalled `web-research-firecrawl` Skill as the controlled search and explicit-page retrieval capability.
- Treat its safety checks, provider limits, EntityPolicy, source guard, and fetch depth as binding.
- Fetch only explicit result URLs. Effective maximum depth is always `0`; never follow discovered site links recursively.
- Do not call shell commands, arbitrary HTTP clients, direct SQL, old Crawler task routes, or dynamic crawler code as substitutes.
- Do not create a new task, page, session, or collection entrypoint.

## Execution Order

1. Read the supplied topic and existing report plan.
2. Convert the plan into a small set of verifiable information gaps.
3. Reuse already prepared sources from the report context before issuing new searches.
4. Search only for remaining gaps through the approved research Skill.
5. Fetch selected target pages with depth `0`.
6. Validate the core entity again against fetched body text.
7. Assess source quality, corroboration, and gap coverage.
8. Return structured results to the current report task. Do not write the report.

Do not replace or rerun the report's existing preparation. This step adds evidence after that preparation and before the existing report generation step.

## Source Classification

- `acceptedSources`: entity match is clear, content is usable, and source quality is sufficient.
- `uncertainSources`: potentially useful but entity, claim, date, or credibility still needs verification.
- Rejected or failed candidates must not appear in either returned source array.
- Never upgrade an uncertain source to accepted to increase counts.
- Never fabricate a URL, title, publisher, date, quotation, or summary.

Each accepted or uncertain source should preserve available fields such as `title`, `url`, `publisher`, `publishedAt`, `summary`, `gapIds`, `relevanceScore`, `credibilityScore`, and `scoreReason`.

## Coverage

- `coveredGaps` contains only gaps supported by accepted sources.
- `uncoveredGaps` contains missing, partially supported, or uncertain-only gaps.
- Conflicting facts remain uncovered or explicitly uncertain.
- If collection cannot run, fail clearly. Do not switch to a different collection workflow and do not invent an empty success.

## Final Output

Return one JSON object only, with no Markdown fences or commentary:

```json
{
  "status": "completed",
  "acceptedSources": [],
  "uncertainSources": [],
  "coveredGaps": [],
  "uncoveredGaps": [],
  "summary": ""
}
```

Use `status: "partial"` when any gap remains uncovered. Use `status: "failed"` with a truthful summary when the approved research capability fails before a valid result can be produced.

Before returning, read [references/safety-and-output.md](references/safety-and-output.md).
