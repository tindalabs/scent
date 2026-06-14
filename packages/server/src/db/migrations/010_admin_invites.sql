-- Account management: soft-deactivation and invite-based provisioning.

-- Soft-deactivate instead of deleting an admin (preserves audit/FK integrity). An
-- inactive user can't log in and existing sessions are rejected (see session.ts /
-- routes/admin.ts login).
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Invites: an owner mints one of these to onboard a new admin without SMTP. The raw
-- token is shown once and travels in the invite link; only its SHA-256 is stored, so
-- the table can't be replayed if leaked. Single-use (accepted_at) and time-boxed
-- (expires_at).
CREATE TABLE IF NOT EXISTS admin_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  token_hash  TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_invites_token ON admin_invites(token_hash);
