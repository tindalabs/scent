# ADR-0007: Usage metering — a durable per-organization resolution ledger (soft limits)

**Status:** Accepted
**Date:** 2026-06-21

## Context

Scent now has a tenant boundary ([ADR-0005](0005-organizations-and-tenancy.md)) and prod
error visibility ([ADR-0006](0006-observability-sentry.md)), but **no way to measure usage** —
the billable unit. The Phase 7 pricing (Free 10k / Pro $249·250k / Enterprise) can't be
applied, and Stripe can't be wired, without a durable per-customer count of work done. The
only existing counters are the ephemeral 60s Redis rate-limit windows (`incrFixedWindow`) —
not a billing source of truth.

This is **slice 1** of billing: the measurement foundation only. Stripe, public self-serve
signup, and hard enforcement are explicit, deferred follow-ups.

## Decision

Add a durable **per-organization, per-UTC-calendar-month** ledger of identity resolutions,
with **soft** limits (measure + warn, never block).

### Billable unit & counting point

One billable resolution = **one committed snapshot**. Resolutions are metered **inside the
existing resolution transaction** in [`resolveSnapshot`](../../packages/server/src/pipeline/resolve.ts)
(`incrementUsage`, an atomic UPSERT into `usage_counters` right after the snapshot insert).
This yields **exactly-once** counting with no extra coordination:

- The `event_id` dedup short-circuits **before** the transaction, so BullMQ at-least-once
  retries and duplicate submissions never reach the increment.
- The increment shares the snapshot's commit/rollback — no count without a stored
  observation, and none double-counted.

Only the **committing** path is metered: `POST /v1/events` (async → worker → `resolveSnapshot`).
`POST /v1/resolve` is a **non-persisting preview** (confidence/risk for a login-flow check
without writing history) and intentionally does **not** count — you bill for committed
observations, not previews. Metering therefore lives in `resolveSnapshot` (the single commit
path), not at the HTTP boundary.

### Schema (migration 015)

- `organizations` gains `plan` (`text`, default `'free'` — forward-looking label for Stripe +
  display) and `monthly_resolution_limit` (`integer`, **NULL = unlimited**).
- `usage_counters(organization_id, period_start, resolution_count, warned_80, warned_100,
  updated_at)`, PK `(organization_id, period_start)`. `period_start` is the first day of the
  UTC calendar month.

### Soft limits & alerting

`checkAndWarnThreshold` runs **after** the transaction commits (side effects out of the
transaction; metering must never delay or fail a resolution). With `monthly_resolution_limit`
NULL it is a no-op (so self-host never warns). On first crossing of 80% / 100% it flips a
once-per-period guard (`warned_80` / `warned_100`) and emits one `logger.warn` +
`Sentry.captureMessage(..., 'warning')` — reusing the shipped error tracking (no-op without
`SENTRY_DSN`), so no new alerting infrastructure. Exceeding the limit **never blocks traffic**.

### Provisioning & surfacing

- Operator CLI `set-org-plan <orgName> <plan> [limit|unlimited]` sets a customer's plan/limit
  (the thin/assisted onboarding path until an org-management UI exists).
- `GET /admin/usage` (org-scoped via the admin session) returns the current period's count,
  limit, %, and recent history; the Observatory **Usage** page renders it.

## Why it composes (self-host unaffected)

`monthly_resolution_limit` defaults NULL, so the single auto-created self-host org is metered
but never warned — zero behaviour change. The counter is purely additive; existing resolution
behaviour and results are untouched (metering is fire-and-forget after commit).

## Consequences

- Usage is finally **visible** (per org, per month) — the prerequisite for billing and for
  validating the pricing tiers against real traffic before enforcing them.
- The single counter row per org/month is a potential write hotspot under high concurrency
  (an org's resolutions contend on one row). Fine at current scale (single box, one design
  partner); documented mitigation if needed: a Redis hot counter flushed periodically, or
  sharded counters.

## Deferred (NOT built here)

Stripe (customer/subscription/checkout/portal/webhooks + usage reporting, anchored on
`organizations.plan`); public self-serve signup (`POST /admin/signup`) + abuse guardrails;
**hard** quota enforcement (402/429); per-project usage breakdown; the Redis hot-counter
optimization; an Observatory org-management UI.

Relates to [ADR-0005](0005-organizations-and-tenancy.md) (orgs are the billing anchor) and the
BSL "Tindalabs-hosted only" commercial model.
