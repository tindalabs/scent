-- Projects / tenants. Each API key maps to exactly one project.
-- All identity data is scoped to a project_id to ensure full tenant isolation.
CREATE TABLE IF NOT EXISTS projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key    TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One persistent entity per real-world browser/device. Survives storage resets via
-- server-side resurrection (Phase 2+). confidence_band and risk_band are denormalized
-- from the latest resolution for fast list queries.
CREATE TABLE IF NOT EXISTS identities (
  id              TEXT        PRIMARY KEY,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_band TEXT        NOT NULL DEFAULT 'unknown',
  risk_band       TEXT        NOT NULL DEFAULT 'low',
  snapshot_count  INTEGER     NOT NULL DEFAULT 0,
  cluster_id      UUID,
  CONSTRAINT chk_confidence_band CHECK (confidence_band IN ('high','medium','low','unknown')),
  CONSTRAINT chk_risk_band       CHECK (risk_band       IN ('critical','high','medium','low'))
);

CREATE INDEX IF NOT EXISTS idx_identities_project ON identities(project_id);
CREATE INDEX IF NOT EXISTS idx_identities_cluster ON identities(cluster_id) WHERE cluster_id IS NOT NULL;

-- One row per sdk.observe() call. event_id is the SDK-generated UUID used for
-- idempotent deduplication — re-sending the same snapshot is a no-op.
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
  CONSTRAINT chk_persistence_policy CHECK (
    persistence_policy IN ('conservative','balanced','aggressive','forensic')
  )
);

CREATE INDEX IF NOT EXISTS idx_snapshots_identity      ON snapshots(identity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_time  ON snapshots(project_id, timestamp DESC);
-- Hash index for SimHash candidate lookups (exact match; Phase 2 uses bk-tree for hamming)
CREATE INDEX IF NOT EXISTS idx_snapshots_signal_hash   ON snapshots(signal_hash);

-- Delta between two consecutive snapshots for the same identity.
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

-- Groups of identities suspected to be operated by the same actor.
CREATE TABLE IF NOT EXISTS clusters (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason     TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clusters_project ON clusters(project_id);
