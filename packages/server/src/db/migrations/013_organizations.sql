-- Organizations: the tenant layer above projects. Until now the install was a single
-- flat namespace — every 'owner' was a global superuser and all projects/admins lived
-- side by side. That is fine for self-hosting (one operator) but unsafe for a hosted
-- multi-customer box, where one company's owner must never see another's data. An
-- organization is now the unit of isolation (and the future anchor for metering/billing).
--
-- Self-host is unaffected: this backfills a single 'Default' org and assigns every
-- existing admin and project to it (mirroring how migration 009 backfilled role), so a
-- single-org install behaves exactly as before.

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  -- Per-org 2FA policy (supersedes the install-wide admin_settings.require_2fa). One
  -- tenant tightening 2FA must not change it for others on the same box.
  require_2fa BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant FKs. Added nullable so the backfill below can populate them before they are
-- constrained NOT NULL. admin_invites carries the org so an accepted invite lands the
-- new admin in the inviting company.
ALTER TABLE admin_users   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE projects      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE admin_invites ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill: if the install already has admins or projects, fold them all into one
-- 'Default' org, seeding its 2FA policy from the existing install-wide setting. A truly
-- empty fresh DB gets no org here — the bootstrap script (create-admin) creates the
-- first org and owner together.
DO $$
DECLARE
  default_org UUID;
  needs_org   BOOLEAN;
  seed_2fa    BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM admin_users) OR EXISTS (SELECT 1 FROM projects) INTO needs_org;
  IF needs_org THEN
    SELECT COALESCE((SELECT require_2fa FROM admin_settings WHERE id = true LIMIT 1), false) INTO seed_2fa;
    INSERT INTO organizations (name, slug, require_2fa)
      VALUES ('Default', 'default', seed_2fa)
      RETURNING id INTO default_org;
    UPDATE admin_users SET organization_id = default_org WHERE organization_id IS NULL;
    UPDATE projects    SET organization_id = default_org WHERE organization_id IS NULL;
  END IF;
END $$;

-- NOTE: organization_id is left NULLABLE here on purpose. The NOT NULL backstop is
-- applied in a later migration, once every writer (the admin routes, create-project,
-- create-admin, and the test helpers) has been made org-aware. Backfilled rows and all
-- app-created rows always carry an org; the constraint just closes the gap last.

CREATE INDEX IF NOT EXISTS idx_admin_users_org   ON admin_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org       ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_admin_invites_org  ON admin_invites(organization_id);
