CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crawler_tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id),
  owner_username VARCHAR(64),
  job_id VARCHAR(64),
  title VARCHAR(512),
  goal TEXT,
  status VARCHAR(32) DEFAULT 'pending',
  crawler_plan JSONB DEFAULT '{}',
  max_pages INTEGER DEFAULT 10,
  max_depth INTEGER DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS crawler_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES crawler_tasks(task_id) ON DELETE CASCADE,
  owner_id UUID REFERENCES users(id),
  job_id VARCHAR(64),
  url TEXT NOT NULL,
  title TEXT,
  publisher VARCHAR(255),
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  content_text TEXT,
  content_summary TEXT,
  metadata JSONB DEFAULT '{}',
  relevance_score NUMERIC,
  credibility_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawler_task_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES crawler_tasks(task_id) ON DELETE CASCADE,
  level VARCHAR(32) DEFAULT 'info',
  message TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawler_tasks_owner_id ON crawler_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_crawler_tasks_job_id ON crawler_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_crawler_tasks_created_at ON crawler_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_crawler_items_task_id ON crawler_items(task_id);
CREATE INDEX IF NOT EXISTS idx_crawler_items_owner_id ON crawler_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_crawler_items_job_id ON crawler_items(job_id);
CREATE INDEX IF NOT EXISTS idx_crawler_task_logs_task_id ON crawler_task_logs(task_id);
