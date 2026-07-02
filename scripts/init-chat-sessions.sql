CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  owner_username VARCHAR(64),
  title VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_id ON chat_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
