-- Links anonymous Scent identities to application-level account IDs.
-- One identity may be linked to many accounts (free-trial abuse pattern);
-- one account may be linked to many identities (device sharing, legitimate multi-user).
-- link_count tracks how many times the same pair has been observed, supporting
-- "consistent association" vs "one-off coincidence" distinction.
CREATE TABLE IF NOT EXISTS identity_account_links (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  identity_id    TEXT        NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  account_id     TEXT        NOT NULL,
  first_linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_count      INTEGER     NOT NULL DEFAULT 1,
  CONSTRAINT uq_identity_account UNIQUE (project_id, identity_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_ial_project_identity ON identity_account_links(project_id, identity_id);
CREATE INDEX IF NOT EXISTS idx_ial_project_account  ON identity_account_links(project_id, account_id);
