CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL DEFAULT '',
  email VARCHAR(255),
  role VARCHAR(32) NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator', 'viewer'))
);

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'viewer';

UPDATE users
SET role = 'viewer'
WHERE role NOT IN ('admin', 'operator', 'viewer');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator', 'viewer'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_users_updated_at();

INSERT INTO users (username, password_hash, display_name, role, is_active)
VALUES (
  'admin',
  '$2b$12$5.l3.9wE1MRi.TOBucFDQenVaZy/4xUpuZY6RNzjjMir887VKC0ke',
  'Administrator',
  'admin',
  true
)
ON CONFLICT (username) DO UPDATE
SET
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  is_active = true,
  updated_at = now();
