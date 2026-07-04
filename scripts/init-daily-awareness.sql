CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS daily_briefs (
    brief_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    brief_date DATE NOT NULL,
    title VARCHAR(512),
    summary TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    total_candidates INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    categories JSONB NOT NULL DEFAULT '[]',
    content_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_brief_events (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES daily_briefs(brief_id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id),
    rank_no INTEGER NOT NULL,
    event_title VARCHAR(512) NOT NULL,
    category VARCHAR(128),
    region VARCHAR(128),
    basic_situation TEXT,
    background_context TEXT,
    importance_judgement TEXT,
    risk_to_us TEXT,
    source_info JSONB NOT NULL DEFAULT '[]',
    related_material_ids JSONB NOT NULL DEFAULT '[]',
    importance_score NUMERIC(5,2) DEFAULT 0,
    risk_score NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_briefs_owner_id_idx ON daily_briefs(owner_id);
CREATE INDEX IF NOT EXISTS daily_briefs_brief_date_idx ON daily_briefs(brief_date);
CREATE INDEX IF NOT EXISTS daily_briefs_created_at_idx ON daily_briefs(created_at);
CREATE INDEX IF NOT EXISTS daily_brief_events_brief_id_idx ON daily_brief_events(brief_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_owner_id_idx ON daily_brief_events(owner_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_rank_no_idx ON daily_brief_events(rank_no);
CREATE INDEX IF NOT EXISTS daily_brief_events_category_idx ON daily_brief_events(category);
CREATE INDEX IF NOT EXISTS daily_brief_events_importance_score_idx ON daily_brief_events(importance_score);
CREATE INDEX IF NOT EXISTS daily_brief_events_risk_score_idx ON daily_brief_events(risk_score);
