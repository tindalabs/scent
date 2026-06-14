-- Two-factor auth (TOTP) for admin accounts.

-- The TOTP shared secret is stored AES-256-GCM-encrypted (app key SCENT_SECRET_KEY),
-- never in clear. totp_enabled flips true only after the user verifies a code, so a
-- half-finished enrollment never gates login.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- One-time recovery codes (hashed; high-entropy so SHA-256 is appropriate, like API
-- keys). Issued when 2FA is enabled; using one sets used_at.
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_user ON admin_recovery_codes(user_id);

-- Install-wide settings, pinned to a single row. require_2fa funnels not-yet-enrolled
-- admins into enrollment before they can do anything else.
CREATE TABLE IF NOT EXISTS admin_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  require_2fa BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO admin_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
