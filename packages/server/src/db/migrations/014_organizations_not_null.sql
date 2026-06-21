-- NOT NULL backstop for the organization tenant FKs. Migration 013 added
-- organization_id as nullable so the backfill and the app writers could be rolled out
-- incrementally; now that every writer (admin routes, create-admin, create-project) sets
-- it, we close the gap at the DB level so a tenant-less project or admin can never exist.

-- Catch any stragglers first: rows an older image may have created after 013 but before
-- the org-aware writers shipped. Bucket them into a 'Default' org (create it if needed)
-- so the constraint can be applied cleanly. In an in-order deploy there are none.
DO $$
DECLARE
  default_org UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM admin_users WHERE organization_id IS NULL)
     OR EXISTS (SELECT 1 FROM projects WHERE organization_id IS NULL) THEN
    SELECT id INTO default_org FROM organizations WHERE name = 'Default' LIMIT 1;
    IF default_org IS NULL THEN
      INSERT INTO organizations (name, slug) VALUES ('Default', 'default')
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO default_org;
    END IF;
    UPDATE admin_users SET organization_id = default_org WHERE organization_id IS NULL;
    UPDATE projects    SET organization_id = default_org WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE admin_users ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE projects    ALTER COLUMN organization_id SET NOT NULL;
