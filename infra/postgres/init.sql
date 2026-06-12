CREATE EXTENSION IF NOT EXISTS "pgcrypto";

COMMENT ON DATABASE scent IS 'Scent identity continuity platform';

-- Full schema inlined here so seed.sql (also run at init time) can
-- reference the projects table. The server's migrate step is idempotent
-- and will be a no-op once these tables exist.

CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_hash TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  key_prefix   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identities (
  id              TEXT        PRIMARY KEY,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_band TEXT        NOT NULL DEFAULT 'unknown',
  risk_band       TEXT        NOT NULL DEFAULT 'low',
  snapshot_count  INTEGER     NOT NULL DEFAULT 0,
  cluster_id      UUID,
  signal_profile  JSONB       NOT NULL DEFAULT '{}',
  CONSTRAINT chk_confidence_band CHECK (confidence_band IN ('high','medium','low','unknown')),
  CONSTRAINT chk_risk_band       CHECK (risk_band       IN ('critical','high','medium','low'))
);

CREATE INDEX IF NOT EXISTS idx_identities_project ON identities(project_id);
CREATE INDEX IF NOT EXISTS idx_identities_cluster ON identities(cluster_id) WHERE cluster_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS snapshots (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        TEXT    NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  project_id         UUID    NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  event_id           TEXT    UNIQUE NOT NULL,
  timestamp          TIMESTAMPTZ NOT NULL,
  signals            JSONB   NOT NULL,
  signal_hash        TEXT    NOT NULL,
  persistence_policy TEXT    NOT NULL,
  traceparent        TEXT,
  client_ip          INET,
  CONSTRAINT chk_persistence_policy CHECK (
    persistence_policy IN ('conservative','balanced','aggressive','forensic')
  )
);

CREATE INDEX IF NOT EXISTS idx_snapshots_identity      ON snapshots(identity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_time  ON snapshots(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_signal_hash   ON snapshots(signal_hash);

CREATE TABLE IF NOT EXISTS drifts (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id         TEXT         NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  before_snapshot_id  UUID         NOT NULL REFERENCES snapshots(id),
  after_snapshot_id   UUID         NOT NULL REFERENCES snapshots(id),
  timestamp           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  classification      TEXT         NOT NULL,
  entropy             NUMERIC(5,4) NOT NULL,
  changed_signals     TEXT[]       NOT NULL DEFAULT '{}',
  added_signals       TEXT[]       NOT NULL DEFAULT '{}',
  removed_signals     TEXT[]       NOT NULL DEFAULT '{}',
  CONSTRAINT chk_classification CHECK (
    classification IN ('minor','moderate','significant','suspicious')
  )
);

CREATE INDEX IF NOT EXISTS idx_drifts_identity ON drifts(identity_id);

CREATE TABLE IF NOT EXISTS clusters (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason     TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clusters_project ON clusters(project_id);

CREATE TABLE IF NOT EXISTS cluster_merges (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      UUID         NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  identity_id     TEXT         NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  merged_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  confidence      NUMERIC(5,4) NOT NULL,
  reason          TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cluster_merges_cluster   ON cluster_merges(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_merges_identity  ON cluster_merges(identity_id);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  TEXT         NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  snapshot_id  UUID         NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  timestamp    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  score        NUMERIC(5,4) NOT NULL,
  band         TEXT         NOT NULL,
  flags        JSONB        NOT NULL DEFAULT '[]',
  CONSTRAINT chk_band CHECK (band IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_identity  ON risk_assessments(identity_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_timestamp ON risk_assessments(identity_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  threshold   NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_threshold CHECK (threshold BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id);
