CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(512) NOT NULL,
  summary TEXT,
  basic_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  actors JSONB NOT NULL DEFAULT '[]'::jsonb,
  category VARCHAR(128),
  region VARCHAR(128),
  importance_score NUMERIC(5,2) DEFAULT 0,
  risk_score NUMERIC(5,2) DEFAULT 0,
  raw_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_sources (
  source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  source_title VARCHAR(512),
  source_url TEXT,
  publisher VARCHAR(255),
  author VARCHAR(255),
  published_at TIMESTAMPTZ,
  content_text TEXT,
  source_summary TEXT,
  relevance_reason TEXT,
  supported_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  supported_attitudes JSONB NOT NULL DEFAULT '[]'::jsonb,
  credibility_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_attitudes (
  attitude_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  actor VARCHAR(255) NOT NULL,
  actor_type VARCHAR(128),
  statement_time TIMESTAMPTZ,
  media VARCHAR(255),
  source_url TEXT,
  attitude_summary TEXT NOT NULL,
  attitude_polarity VARCHAR(64),
  confidence NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_outlines (
  outline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  version_no INTEGER NOT NULL DEFAULT 1,
  title VARCHAR(512),
  outline_json JSONB NOT NULL,
  user_feedback TEXT,
  edit_type VARCHAR(32) NOT NULL DEFAULT 'ai',
  parent_outline_id UUID REFERENCES report_outlines(outline_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_outlines_edit_type_check CHECK (edit_type IN ('ai', 'ai_refine', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_event_sources_event_id ON event_sources(event_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_owner_id ON event_sources(owner_id);
CREATE INDEX IF NOT EXISTS idx_event_attitudes_event_id ON event_attitudes(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attitudes_owner_id ON event_attitudes(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_outlines_event_id ON report_outlines(event_id);
CREATE INDEX IF NOT EXISTS idx_report_outlines_owner_id ON report_outlines(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_outlines_version_no ON report_outlines(version_no);
