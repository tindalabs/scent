-- SimHash blocking index for candidate retrieval.
--
-- Before this, every POST /v1/events scanned the latest snapshot of *every*
-- identity in the project, pulled the full signals JSONB into the server, and
-- scored each one in JS — O(N) per ingest with heavy JSONB marshaling.
--
-- We denormalize the latest snapshot's 64-bit SimHash onto the identity row as
-- a signed BIGINT (two's-complement packing of the [hi, lo] halves). Candidate
-- retrieval then becomes an in-database Hamming pre-filter:
--   WHERE project_id = $1 AND bit_count(latest_signal_hash # $2) <= threshold
-- which returns only plausible matches; full signals are fetched for just those.
-- Exact same recall as the previous JS pre-filter (bit_count of the XOR is the
-- Hamming distance), but the per-identity work happens in C inside Postgres.

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS latest_signal_hash BIGINT;

-- Backfill from the most-recent snapshot per identity. The stored signal_hash
-- is a 16-char hex string; ('x' || hex)::bit(64)::bigint reinterprets it as the
-- same signed 64-bit value simHashToInt64() produces server-side.
UPDATE identities i
SET latest_signal_hash = sub.h
FROM (
  SELECT DISTINCT ON (identity_id)
    identity_id,
    ('x' || signal_hash)::bit(64)::bigint AS h
  FROM snapshots
  ORDER BY identity_id, timestamp DESC
) sub
WHERE i.id = sub.identity_id;

-- Covering index: lets the candidate pre-filter run as an index-only scan over
-- the project's identities (project_id range + latest_signal_hash + id) without
-- touching the heap until a candidate survives the Hamming filter.
CREATE INDEX IF NOT EXISTS idx_identities_blocking
  ON identities (project_id, latest_signal_hash) INCLUDE (id)
  WHERE latest_signal_hash IS NOT NULL;
