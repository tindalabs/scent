import type { Sql } from 'postgres';
import { logger } from '../logger.js';

// The repeatable retention sweep runs on its own BullMQ queue (separate from ingest).
export const RETENTION_QUEUE_NAME = 'retention';

// Deletes identities whose most recent activity (last_seen) is older than their
// project's retention_days; snapshots, drifts, risk assessments, cluster merges, and
// account links cascade (ON DELETE CASCADE on identity_id). Projects with a null or
// non-positive retention_days keep data indefinitely and are skipped. Idempotent —
// safe to run repeatedly. Returns per-run counts for logging. (GDPR data-lifecycle,
// ADR-0004.)
export async function sweepRetention(
  sql: Sql,
): Promise<{ projects: number; identitiesDeleted: number }> {
  const projects = await sql<{ id: string; retention_days: number }[]>`
    SELECT id, retention_days
    FROM projects
    WHERE retention_days IS NOT NULL AND retention_days > 0
  `;

  let identitiesDeleted = 0;
  for (const p of projects) {
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM identities
      WHERE project_id = ${p.id}
        AND last_seen < now() - make_interval(days => ${p.retention_days})
      RETURNING id
    `;
    identitiesDeleted += deleted.length;
  }

  logger.info({ projects: projects.length, identitiesDeleted }, 'retention sweep complete');
  return { projects: projects.length, identitiesDeleted };
}
