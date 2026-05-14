-- Phase 2 will add the full schema via migrations.
-- This file is intentionally minimal — just enough to verify the DB starts clean.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

COMMENT ON DATABASE scent IS 'Scent identity continuity platform';
