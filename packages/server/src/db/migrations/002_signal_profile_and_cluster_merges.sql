-- Per-identity signal presence tracking. Stored as JSONB:
-- { "canvas.2d": { "consecutiveAbsences": 0, "lastSeen": "2026-05-01T..." } }
-- Updated on every snapshot ingestion. Used to decay signal weights when
-- a signal has been absent from the last N observations for this identity.
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS signal_profile JSONB NOT NULL DEFAULT '{}';

-- Audit trail for when two identities are linked into a coordination cluster.
-- Captures the reason and the confidence at merge time so Observatory can
-- explain why identities were grouped.
CREATE TABLE IF NOT EXISTS cluster_merges (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      UUID        NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  identity_id     TEXT        NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  merged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC(5,4) NOT NULL,
  reason          TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cluster_merges_cluster   ON cluster_merges(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_merges_identity  ON cluster_merges(identity_id);
