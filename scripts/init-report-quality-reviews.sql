CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS report_quality_reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(64) NOT NULL,
  owner_id UUID REFERENCES users(id),
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  overall_score INTEGER,
  factual_clarity_score INTEGER,
  plan_alignment_score INTEGER,
  source_quality_score INTEGER,
  attitude_traceability_score INTEGER,
  risk_reasoning_score INTEGER,
  writing_quality_score INTEGER,
  word_count INTEGER,
  review_json JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_quality_reviews_job_id ON report_quality_reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_report_quality_reviews_owner_id ON report_quality_reviews(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_quality_reviews_created_at ON report_quality_reviews(created_at);
