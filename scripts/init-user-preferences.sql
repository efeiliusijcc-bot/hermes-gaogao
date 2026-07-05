CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_report_type VARCHAR(128),
  default_region VARCHAR(128),
  default_language VARCHAR(32) DEFAULT 'zh-CN',
  writing_style VARCHAR(128),
  tone VARCHAR(128),
  default_source_options JSONB NOT NULL DEFAULT '{}',
  default_outline_options JSONB NOT NULL DEFAULT '{}',
  preference_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id)
);

CREATE INDEX IF NOT EXISTS user_preferences_owner_id_idx ON user_preferences(owner_id);

CREATE TABLE IF NOT EXISTS user_report_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_name VARCHAR(255) NOT NULL,
  template_type VARCHAR(128),
  description TEXT,
  template_json JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_report_templates_owner_id_idx ON user_report_templates(owner_id);
CREATE INDEX IF NOT EXISTS user_report_templates_template_type_idx ON user_report_templates(template_type);
CREATE INDEX IF NOT EXISTS user_report_templates_is_default_idx ON user_report_templates(is_default);

CREATE TABLE IF NOT EXISTS user_prompt_snippets (
  snippet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snippet_name VARCHAR(255) NOT NULL,
  snippet_type VARCHAR(128),
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_prompt_snippets_owner_id_idx ON user_prompt_snippets(owner_id);
CREATE INDEX IF NOT EXISTS user_prompt_snippets_snippet_type_idx ON user_prompt_snippets(snippet_type);
