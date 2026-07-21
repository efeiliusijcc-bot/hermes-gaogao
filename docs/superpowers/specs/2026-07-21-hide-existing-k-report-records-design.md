# Temporarily Hide Existing K-Report Records

## Goal

Keep the AI deep-report/K-report history feature available while temporarily hiding only the records that already existed at the agreed cutoff time. Reports created after the cutoff must appear in history immediately.

## Scope

- Restore the report-history sidebar, full history list, navigation, search, pagination, trash, and detail actions.
- Add an optional production cutoff configuration for report-history queries.
- Exclude records whose `createdAt` is at or before the cutoff from normal and trash history queries.
- Preserve all report rows, generated files, drafts, permissions, and generation behavior.
- Leave QA history and Daily Awareness history unchanged.

## Design

The frontend reads an optional build-time cutoff and sends it as `createdAfter` on both recent-report and full-list requests. The report list API validates the timestamp and applies the filter before sorting, counting, and pagination. This keeps totals and pages consistent and prevents old records from leaking onto later pages.

The cutoff is temporary and non-destructive. Production enables it with an ISO-8601 timestamp representing the correction deployment boundary. A newly created report has a later `createdAt`, so it appears immediately in both recent history and the complete list.

## Restoration

To restore all historical records, remove or clear the production cutoff configuration and redeploy the frontend. No database migration, restore operation, or record rewrite is required.

## Failure Boundaries

- Missing cutoff: return all authorized records.
- Invalid cutoff: ignore it rather than hiding records unexpectedly.
- Direct report access and generation APIs remain unchanged.
- Authorization filters continue to apply before records are returned.

## Verification

- Unit-test cutoff parsing and boundary behavior.
- API-test filtering before totals and pagination.
- Frontend source test confirms both history requests include the cutoff while the history UI remains enabled.
- Run frontend and backend builds.
- Verify production shows an empty existing K-report history, then confirm a newly generated report can appear without removing the cutoff.
