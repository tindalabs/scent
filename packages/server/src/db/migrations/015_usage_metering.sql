-- Usage metering: a durable per-organization, per-calendar-month ledger of identity
-- resolutions — the billable unit. Until now the only counters were the ephemeral 60s
-- Redis rate-limit windows, which can't anchor billing. This is slice 1 of Phase 7
-- (metering only; Stripe and enforcement come later): measure usage, surface it, and
-- warn softly at thresholds — never block.
--
-- Self-host is unaffected: organizations.monthly_resolution_limit defaults NULL
-- (unlimited), so the single auto-created org is metered but never warned. A hosted
-- customer's limit is set explicitly by the operator (set-org-plan CLI).

-- Plan label (forward-looking, for the upcoming Stripe work + display) and the soft
-- monthly cap. NULL limit = unlimited / un-provisioned: counted but no warnings.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS monthly_resolution_limit INTEGER;

-- One row per org per UTC calendar month. resolution_count is incremented inside the
-- resolution transaction (exactly-once via the upstream event_id dedup). warned_80 /
-- warned_100 are once-per-threshold-per-period guards so a soft-limit alert fires once.
CREATE TABLE IF NOT EXISTS usage_counters (
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start     DATE NOT NULL,                      -- first day of the UTC month
  resolution_count BIGINT NOT NULL DEFAULT 0,
  warned_80        BOOLEAN NOT NULL DEFAULT false,
  warned_100       BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, period_start)
);
