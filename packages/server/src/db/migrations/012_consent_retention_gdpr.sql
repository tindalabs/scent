-- Consent provenance + data-lifecycle (ADR-0004).

-- Provenance per snapshot: under what lawful basis it was collected, the controller's
-- consent-policy version, and when consent was granted. The SDK forwards these; they
-- are stored immutably alongside the snapshot so consent can be demonstrated (GDPR
-- Art. 7(1)). All nullable — older rows and strictly-necessary collection may omit them.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS lawful_basis TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS consent_version TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ;

-- Per-project data-lifecycle settings.
--   retention_days       NULL = keep forever; otherwise the retention sweeper deletes
--                        identities whose last_seen is older than this many days.
--   store_full_ip        false (default) = store a network-truncated IP (/24 v4, /48 v6),
--                        which still resolves to a city for impossible-travel while
--                        minimising personal data. true = store the full address
--                        (requires a documented lawful basis).
--   lawful_basis_default the basis recorded when a snapshot arrives without one.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS retention_days INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS store_full_ip BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lawful_basis_default TEXT NOT NULL DEFAULT 'consent';
