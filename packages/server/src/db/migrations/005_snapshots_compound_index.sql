-- Compound index for the candidate-scan query in events.ts.
-- DISTINCT ON (identity_id) ORDER BY identity_id, timestamp DESC on
-- WHERE project_id = $1 hits this index directly, avoiding a full
-- project-wide sequential scan that grows O(n) with snapshot volume.
CREATE INDEX IF NOT EXISTS idx_snapshots_project_identity_time
  ON snapshots(project_id, identity_id, timestamp DESC);
