-- Client IP captured server-side at ingestion time, used for impossible transition detection.
-- Stored as INET (native PostgreSQL type) for correct IPv4/IPv6 handling.
ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS client_ip INET;

-- One row per risk assessment, one assessment per snapshot ingestion.
-- Flags stored as JSONB: [{ code, label, reason, confidence }]
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

-- Project-level webhook configuration for risk_elevated events.
-- A webhook fires when a new risk assessment score exceeds the threshold.
CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  threshold   NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_threshold CHECK (threshold BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id);
