-- Role-based access control for admin users. Two levels:
--   1. A global role on admin_users: 'owner' (superuser — manages admins and every
--      project) or 'member' (only the projects explicitly granted below).
--   2. Per-project membership: which projects a member can touch and whether they can
--      manage keys ('admin') or only read data ('viewer'). Owners need no rows here —
--      their access is implicit.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'member'));

-- Accounts that predate RBAC were unrestricted, so preserve that: make them owners.
-- (New accounts default to 'member' and are granted access explicitly.)
UPDATE admin_users SET role = 'owner' WHERE created_at < now();

-- A user's access to a specific project. Cascades on either side so deleting a user
-- or a project cleans up the grants.
CREATE TABLE IF NOT EXISTS project_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
