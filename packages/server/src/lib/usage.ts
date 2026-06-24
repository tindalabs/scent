import * as Sentry from '@sentry/node';
import type { Sql, TransactionSql } from 'postgres';
import { logger } from '../logger.js';

// Usage metering (Phase 7, slice 1). The billable unit is one committed identity
// resolution; this records it durably per organization per UTC calendar month. Soft
// posture: we measure and warn, never block.

export interface UsageIncrement {
  organizationId: string;
  periodCount: number;
}

// Atomically records one resolution for the project's organization in the current
// month and returns the running count. Resolves project -> org inline so the hot path
// needs no separate lookup. MUST run inside the resolution transaction: paired with the
// snapshot insert, the upstream event_id dedup guarantees exactly-once counting (retries
// short-circuit before the transaction) and a rollback un-counts atomically.
//
// Returns null only if the project has no organization (shouldn't happen post-migration
// 014's NOT NULL backstop) — callers then skip the threshold check.
export async function incrementUsage(
  tx: TransactionSql,
  projectId: string,
): Promise<UsageIncrement | null> {
  const [row] = await tx<{ organization_id: string; resolution_count: string }[]>`
    INSERT INTO usage_counters (organization_id, period_start, resolution_count)
    SELECT p.organization_id, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1
    FROM projects p
    WHERE p.id = ${projectId} AND p.organization_id IS NOT NULL
    ON CONFLICT (organization_id, period_start)
    DO UPDATE SET resolution_count = usage_counters.resolution_count + 1, updated_at = now()
    RETURNING organization_id, resolution_count
  `;
  if (!row) return null;
  // resolution_count is BIGINT -> string over the wire; fine to Number() at these scales.
  return { organizationId: row.organization_id, periodCount: Number(row.resolution_count) };
}

// Soft-limit alerting. Runs AFTER the resolution transaction commits (side effects out
// of the transaction; must never delay or fail a resolution). Reads the org's monthly
// limit (NULL/0 = unlimited -> no-op, so self-host never warns), and on first crossing
// of 80% / 100% flips a once-per-period guard and emits one warning to the logger and
// Sentry (reusing the shipped error-tracking setup; no-op without SENTRY_DSN).
export async function checkAndWarnThreshold(
  db: Sql,
  organizationId: string,
  periodCount: number,
): Promise<void> {
  const [org] = await db<{ monthly_resolution_limit: number | null }[]>`
    SELECT monthly_resolution_limit FROM organizations WHERE id = ${organizationId} LIMIT 1
  `;
  const limit = org?.monthly_resolution_limit ?? null;
  if (limit == null || limit <= 0) return; // unlimited / un-provisioned
  const pct = periodCount / limit;
  if (pct < 0.8) return;

  if (pct >= 1.0) {
    // Flip both guards: once at 100% we never want a late 80% alert.
    const flipped = await db`
      UPDATE usage_counters
      SET warned_100 = true, warned_80 = true
      WHERE organization_id = ${organizationId}
        AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date
        AND warned_100 = false
      RETURNING organization_id
    `;
    if (flipped.length > 0) emitWarning(organizationId, periodCount, limit, 100);
  } else {
    const flipped = await db`
      UPDATE usage_counters
      SET warned_80 = true
      WHERE organization_id = ${organizationId}
        AND period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date
        AND warned_80 = false
      RETURNING organization_id
    `;
    if (flipped.length > 0) emitWarning(organizationId, periodCount, limit, 80);
  }
}

function emitWarning(
  organizationId: string,
  periodCount: number,
  limit: number,
  threshold: 80 | 100,
): void {
  logger.warn(
    { organizationId, periodCount, limit, threshold },
    `organization reached ${threshold}% of its monthly resolution quota`,
  );
  Sentry.captureMessage(
    `Org ${organizationId} at ${threshold}% of monthly resolution quota (${periodCount}/${limit})`,
    'warning',
  );
}
