import type { Sql } from 'postgres';
import type { RiskAssessment } from './assess.js';
import { logger } from '../logger.js';

// Fire-and-forget webhook delivery. Called after risk assessment when the score
// exceeds the project's configured threshold. Failures are logged but not retried
// in Phase 3 — a retry queue is a Phase 7 concern.
export async function deliverWebhooks(
  sql: Sql,
  projectId: string,
  identityId: string,
  snapshotId: string,
  assessment: RiskAssessment,
): Promise<void> {
  const webhooks = await sql<{ url: string; threshold: number }[]>`
    SELECT url, threshold FROM webhooks
    WHERE project_id = ${projectId} AND threshold <= ${assessment.score}
  `;

  if (webhooks.length === 0) return;

  const payload = JSON.stringify({
    event: 'risk_elevated',
    identityId,
    snapshotId,
    score: assessment.score,
    band: assessment.band,
    flags: assessment.flags,
    timestamp: new Date().toISOString(),
  });

  await Promise.allSettled(
    webhooks.map(({ url }) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(5000),
      }).catch((err: unknown) => {
        logger.error({ err, url }, 'webhook delivery failed');
      }),
    ),
  );
}
