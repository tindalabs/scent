-- Admin accounts for the Observatory key-management UI. These are distinct from
-- project API keys: a project key authenticates the data API (/v1/*), while admin
-- users authenticate the management API (/admin/*) that mints/rotates/revokes keys.

-- Admin users. Passwords are hashed with a slow salted KDF (bcrypt) in the app —
-- NOT the fast SHA-256 used for high-entropy API keys.
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Server-side sessions: the cookie carries a random opaque token; only its SHA-256
-- is stored here, so a DB leak can't be replayed. Deleting a row revokes the session.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

-- Non-secret display hint (first chars of the key) so the management UI can list a
-- recognizable label without ever exposing the key. Set on create/rotate.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_prefix TEXT;
