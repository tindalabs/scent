-- Store API keys as a SHA-256 hash instead of plaintext. Keys are high-entropy
-- random tokens, so a fast unsalted hash is the right tool (O(1) lookup, no
-- rainbow-table risk) — see middleware/api-key.ts. The plaintext is only ever
-- shown once at creation.
--
-- Idempotent and safe on both fresh DBs (where the projects table may already use
-- api_key_hash, e.g. created from infra/postgres/init.sql) and legacy DBs that still
-- have the plaintext api_key column.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_key_hash TEXT;

-- Backfill from and then drop the legacy plaintext column, if it still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'api_key'
  ) THEN
    UPDATE projects
       SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex')
     WHERE api_key_hash IS NULL;
    ALTER TABLE projects DROP COLUMN api_key;
  END IF;
END $$;

ALTER TABLE projects ALTER COLUMN api_key_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_api_key_hash ON projects(api_key_hash);
