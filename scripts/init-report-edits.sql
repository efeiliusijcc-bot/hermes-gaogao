CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS report_edits (
  edit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(64) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  target_type VARCHAR(64) NOT NULL,
  target_path TEXT,
  original_text TEXT NOT NULL,
  instruction TEXT NOT NULL,
  edited_text TEXT NOT NULL,
  edit_mode VARCHAR(64) NOT NULL DEFAULT 'rewrite',
  model_used VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_edits_job_id_idx ON report_edits(job_id);
CREATE INDEX IF NOT EXISTS report_edits_owner_id_idx ON report_edits(owner_id);
CREATE INDEX IF NOT EXISTS report_edits_created_at_idx ON report_edits(created_at);
