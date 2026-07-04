CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS report_plans (
  plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outline_id UUID NOT NULL REFERENCES report_outlines(outline_id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_plans_owner_id ON report_plans(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_plans_outline_id ON report_plans(outline_id);
CREATE INDEX IF NOT EXISTS idx_report_plans_event_id ON report_plans(event_id);
CREATE INDEX IF NOT EXISTS idx_report_plans_created_at ON report_plans(created_at);
