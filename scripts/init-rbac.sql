CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (resource, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO roles (name, description, is_system)
VALUES
  ('admin', 'System administrator with all permissions', true)
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system;

INSERT INTO permissions (resource, action, description)
VALUES
  ('report', 'create', 'Create report jobs and report plans'),
  ('report', 'read', 'Read report jobs and results'),
  ('report', 'update', 'Update or manage report jobs'),
  ('report', 'delete', 'Delete report jobs'),
  ('chat', 'execute', 'Execute chat completions'),
  ('chat', 'read', 'Read chat sessions and sources'),
  ('research_key', 'read', 'Read research key status'),
  ('research_key', 'update', 'Update research keys'),
  ('vector_source', 'read', 'Read vector source status and profiles'),
  ('vector_source', 'update', 'Update vector source profile or index'),
  ('user', 'manage', 'Manage users'),
  ('role', 'manage', 'Manage roles and permissions'),
  ('draft_assistant', 'create', 'Create Draft Assistant events or outlines'),
  ('draft_assistant', 'read', 'Read Draft Assistant events and outlines'),
  ('draft_assistant', 'update', 'Update Draft Assistant outlines'),
  ('daily_awareness', 'create', 'Create daily awareness briefs'),
  ('daily_awareness', 'read', 'Read daily awareness briefs'),
  ('daily_awareness', 'import', 'Import daily awareness events'),
  ('daily-awareness', 'view', 'View shared daily awareness briefs and exports'),
  ('system:daily-awareness', 'manage', 'Manage daily awareness configuration, runs, and regeneration'),
  ('preference', 'read', 'Read own user preferences'),
  ('preference', 'update', 'Update own user preferences'),
  ('template', 'create', 'Create own report templates and prompt snippets'),
  ('template', 'read', 'Read own report templates and prompt snippets'),
  ('template', 'update', 'Update own report templates and prompt snippets'),
  ('template', 'delete', 'Delete own report templates and prompt snippets'),
  ('crawler', 'create', 'Create controlled crawler tasks'),
  ('crawler', 'execute', 'Execute controlled crawler tasks'),
  ('crawler', 'read', 'Read controlled crawler tasks and collected items'),
  ('crawler', 'delete', 'Delete controlled crawler tasks')
ON CONFLICT (resource, action) DO UPDATE
SET description = EXCLUDED.description;

DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.name = 'admin';

DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.name IN ('operator', 'viewer');

INSERT INTO role_permissions (role_id, permission_id)
SELECT old_assignment.role_id, new_permission.id
FROM role_permissions old_assignment
JOIN permissions old_permission ON old_permission.id = old_assignment.permission_id
JOIN permissions new_permission
  ON new_permission.resource = 'daily-awareness'
 AND new_permission.action = 'view'
WHERE old_permission.resource = 'daily_awareness'
  AND old_permission.action = 'read'
ON CONFLICT DO NOTHING;

WITH admin_permissions(permission_key) AS (
  VALUES
    ('report:create'),
    ('report:read'),
    ('report:update'),
    ('chat:execute'),
    ('chat:read'),
    ('draft_assistant:create'),
    ('draft_assistant:read'),
    ('draft_assistant:update'),
    ('daily_awareness:create'),
    ('daily_awareness:read'),
    ('daily_awareness:import'),
    ('daily-awareness:view'),
    ('system:daily-awareness:manage'),
    ('preference:read'),
    ('preference:update'),
    ('template:create'),
    ('template:read'),
    ('template:update'),
    ('template:delete'),
    ('crawler:create'),
    ('crawler:execute'),
    ('crawler:read'),
    ('user:manage'),
    ('role:manage'),
    ('research_key:read'),
    ('research_key:update'),
    ('vector_source:read'),
    ('vector_source:update'),
    ('report:delete'),
    ('crawler:delete')
),
resolved AS (
  SELECT r.id AS role_id, p.id AS permission_id
  FROM roles r
  JOIN admin_permissions ap ON true
  JOIN permissions p ON concat(p.resource, ':', p.action) = ap.permission_key
  WHERE r.name = 'admin'
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id
FROM resolved
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name = u.role
WHERE u.role = 'admin'
ON CONFLICT DO NOTHING;
