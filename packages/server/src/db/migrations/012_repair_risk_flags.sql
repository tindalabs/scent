-- Repair risk_assessments.flags rows that were stored double-encoded as a JSON string
-- scalar instead of a JSON array. Cause: the insert used `${JSON.stringify(flags)}::jsonb`,
-- which postgres.js double-encodes (the parameter is sent as a JSON string, then cast to
-- jsonb, yielding a string scalar). The insert now uses sql.json(flags) (risk/assess.ts).
--
-- For affected rows, `flags #>> '{}'` extracts the scalar's text (the real JSON array
-- text), and ::jsonb re-parses it into the array it always represented. The `score`
-- column was computed in-memory from the correct array at insert time, so it's untouched.
UPDATE risk_assessments
SET flags = (flags #>> '{}')::jsonb
WHERE jsonb_typeof(flags) = 'string';
