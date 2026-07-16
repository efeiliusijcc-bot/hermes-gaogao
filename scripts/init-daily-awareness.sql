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

ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS publication_scope VARCHAR(16) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS quality_status VARCHAR(32);
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS content_markdown TEXT;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS generated_by_type VARCHAR(16);
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS generation_run_id UUID;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS summary_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS title_only_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

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

CREATE TABLE IF NOT EXISTS daily_awareness_day_status (
    business_date DATE PRIMARY KEY,
    data_status VARCHAR(32) NOT NULL DEFAULT 'WAITING'
      CHECK (data_status IN ('WAITING', 'READY', 'NO_DATA')),
    generation_status VARCHAR(32) NOT NULL DEFAULT 'WAITING'
      CHECK (generation_status IN ('WAITING', 'PENDING', 'GENERATING', 'SUCCESS', 'GENERATION_FAILED', 'NOT_REQUIRED')),
    quality_status VARCHAR(32)
      CHECK (quality_status IS NULL OR quality_status IN ('NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY')),
    batch_id VARCHAR(256),
    data_completed_at TIMESTAMPTZ,
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    summary_count INTEGER NOT NULL DEFAULT 0 CHECK (summary_count >= 0),
    title_only_count INTEGER NOT NULL DEFAULT 0 CHECK (title_only_count >= 0),
    skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    current_brief_id UUID REFERENCES daily_briefs(brief_id) ON DELETE SET NULL,
    last_run_id UUID,
    last_error_code VARCHAR(128),
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_awareness_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date DATE NOT NULL,
    trigger_type VARCHAR(32) NOT NULL
      CHECK (trigger_type IN ('EVENT', 'AUTO_RETRY', 'MANUAL', 'INBOX_REPROCESS')),
    trigger_ref VARCHAR(256),
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED'
      CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCESS', 'NO_DATA', 'FAILED', 'IGNORED_DUPLICATE')),
    attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    quality_status VARCHAR(32)
      CHECK (quality_status IS NULL OR quality_status IN ('NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY')),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    summary_count INTEGER NOT NULL DEFAULT 0 CHECK (summary_count >= 0),
    title_only_count INTEGER NOT NULL DEFAULT 0 CHECK (title_only_count >= 0),
    skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    model_provider VARCHAR(128),
    model_name VARCHAR(256),
    prompt_version VARCHAR(128),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_code VARCHAR(128),
    error_message TEXT,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    manual_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_awareness_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    lookback_hours INTEGER NOT NULL DEFAULT 24 CHECK (lookback_hours BETWEEN 1 AND 168),
    max_articles INTEGER NOT NULL DEFAULT 50 CHECK (max_articles BETWEEN 1 AND 3000),
    category_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_retry_count INTEGER NOT NULL DEFAULT 3 CHECK (max_retry_count BETWEEN 0 AND 10),
    retry_interval_seconds INTEGER NOT NULL DEFAULT 30 CHECK (retry_interval_seconds BETWEEN 1 AND 3600),
    summary_max_chars INTEGER NOT NULL DEFAULT 1200 CHECK (summary_max_chars BETWEEN 100 AND 10000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_awareness_event_inbox (
    event_id VARCHAR(256) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL CHECK (event_type = 'DAILY_DATA_FINISHED'),
    business_date DATE NOT NULL,
    batch_id VARCHAR(256) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    total_count INTEGER CHECK (total_count IS NULL OR total_count >= 0),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED'
      CHECK (status IN ('RECEIVED', 'PROCESSING', 'RETRY_PENDING', 'PROCESSED', 'DEAD_LETTER')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(256),
    processed_at TIMESTAMPTZ,
    last_error_code VARCHAR(128),
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO daily_awareness_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

WITH dates_without_global AS (
    SELECT brief_date
    FROM daily_briefs
    GROUP BY brief_date
    HAVING count(*) FILTER (WHERE publication_scope = 'GLOBAL') = 0
),
ranked AS (
    SELECT
        b.brief_id,
        row_number() OVER (
            PARTITION BY b.brief_date
            ORDER BY b.updated_at DESC, b.created_at DESC, b.brief_id DESC
        ) AS canonical_rank
    FROM daily_briefs b
    JOIN dates_without_global d ON d.brief_date = b.brief_date
    WHERE lower(b.status) IN ('completed', 'success')
)
UPDATE daily_briefs b
SET
    publication_scope = 'GLOBAL',
    quality_status = COALESCE(b.quality_status, 'NORMAL'),
    content_markdown = COALESCE(NULLIF(b.content_markdown, ''), b.content_json ->> 'reportMarkdown', ''),
    generated_at = COALESCE(b.generated_at, b.updated_at, b.created_at),
    generated_by_type = COALESCE(b.generated_by_type, 'SYSTEM'),
    source_count = GREATEST(b.source_count, b.total_candidates),
    summary_count = GREATEST(b.summary_count, b.total_candidates),
    title_only_count = GREATEST(b.title_only_count, 0),
    skipped_count = GREATEST(b.skipped_count, 0)
FROM ranked r
WHERE b.brief_id = r.brief_id
  AND r.canonical_rank = 1;

CREATE UNIQUE INDEX IF NOT EXISTS daily_briefs_global_business_date_uidx
    ON daily_briefs (brief_date)
    WHERE publication_scope = 'GLOBAL';

INSERT INTO daily_awareness_day_status (
    business_date,
    data_status,
    generation_status,
    quality_status,
    source_count,
    summary_count,
    title_only_count,
    skipped_count,
    current_brief_id,
    updated_at
)
SELECT
    b.brief_date,
    'READY',
    'SUCCESS',
    COALESCE(b.quality_status, 'NORMAL'),
    b.source_count,
    b.summary_count,
    b.title_only_count,
    b.skipped_count,
    b.brief_id,
    COALESCE(b.generated_at, b.updated_at, b.created_at)
FROM daily_briefs b
WHERE b.publication_scope = 'GLOBAL'
ON CONFLICT (business_date) DO NOTHING;

CREATE INDEX IF NOT EXISTS daily_briefs_owner_id_idx ON daily_briefs(owner_id);
CREATE INDEX IF NOT EXISTS daily_briefs_brief_date_idx ON daily_briefs(brief_date);
CREATE INDEX IF NOT EXISTS daily_briefs_created_at_idx ON daily_briefs(created_at);
CREATE INDEX IF NOT EXISTS daily_brief_events_brief_id_idx ON daily_brief_events(brief_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_owner_id_idx ON daily_brief_events(owner_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_rank_no_idx ON daily_brief_events(rank_no);
CREATE INDEX IF NOT EXISTS daily_brief_events_category_idx ON daily_brief_events(category);
CREATE INDEX IF NOT EXISTS daily_brief_events_importance_score_idx ON daily_brief_events(importance_score);
CREATE INDEX IF NOT EXISTS daily_brief_events_risk_score_idx ON daily_brief_events(risk_score);
CREATE INDEX IF NOT EXISTS daily_awareness_day_status_generation_idx ON daily_awareness_day_status(generation_status, business_date DESC);
CREATE INDEX IF NOT EXISTS daily_awareness_runs_business_date_idx ON daily_awareness_runs(business_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS daily_awareness_runs_status_idx ON daily_awareness_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS daily_awareness_event_inbox_claim_idx ON daily_awareness_event_inbox(status, next_attempt_at, created_at);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_briefs_publication_scope_check') THEN
        ALTER TABLE daily_briefs
            ADD CONSTRAINT daily_briefs_publication_scope_check
            CHECK (publication_scope IN ('GLOBAL', 'LEGACY'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_briefs_quality_status_check') THEN
        ALTER TABLE daily_briefs
            ADD CONSTRAINT daily_briefs_quality_status_check
            CHECK (quality_status IS NULL OR quality_status IN ('NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_briefs_generated_by_type_check') THEN
        ALTER TABLE daily_briefs
            ADD CONSTRAINT daily_briefs_generated_by_type_check
            CHECK (generated_by_type IS NULL OR generated_by_type IN ('SYSTEM', 'MANUAL'));
    END IF;
END
$$;
