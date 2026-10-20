export const DRAFT_ANALYSIS_SCHEMA = `
CREATE TABLE IF NOT EXISTS draft_analysis_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(event_id),
  owner_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  input_hash text NOT NULL,
  input_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  step text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  deadline_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '120 seconds'),
  lease_token uuid,
  heartbeat_at timestamptz,
  slot smallint CHECK (slot IN (1,2)),
  error_code text,
  error_message text,
  UNIQUE(owner_id, client_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS draft_analysis_one_active_owner
  ON draft_analysis_jobs(owner_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS draft_analysis_one_active_event
  ON draft_analysis_jobs(event_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS draft_analysis_worker_slots
  ON draft_analysis_jobs(slot) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS draft_analysis_event_latest ON draft_analysis_jobs(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draft_analysis_owner_latest ON draft_analysis_jobs(owner_id, created_at DESC);
`;

const iso = (value: unknown) => value ? (value instanceof Date ? value : new Date(String(value))).toISOString() : null;
export function draftAnalysisJob(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    jobId: String(row.job_id), eventId: String(row.event_id),
    clientRequestId: String(row.client_request_id),
    status: String(row.status), step: String(row.step),
    createdAt: iso(row.created_at), startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at), deadlineAt: iso(row.deadline_at),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}
export type DraftAnalysisJob = NonNullable<ReturnType<typeof draftAnalysisJob>>;
