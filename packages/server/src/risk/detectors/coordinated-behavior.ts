import type { RiskFlag } from '@irregular/scent-engine';
import type { Sql } from 'postgres';

// Finds other identities in this project that share nearly identical stable signal
// hashes but are NOT already in the same cluster as the current identity.
// The pattern: same device/operator using many distinct volatile signals
// (VPN rotation, user-agent cycling) while the underlying hardware stays constant.
//
// Candidate lookup uses the same hash-prefix heuristic as rapid-reregistration.
// Identities already in the same cluster are excluded — they've already been flagged.
export async function detectCoordinatedBehavior(
  sql: Sql,
  projectId: string,
  identityId: string,
  signalHash: string,
  clusterId: string | null,
): Promise<RiskFlag | null> {
  const hashPrefix = signalHash.slice(0, 4);

  const rows = await sql<{ identity_id: string }[]>`
    SELECT DISTINCT s.identity_id
    FROM snapshots s
    JOIN identities i ON i.id = s.identity_id
    WHERE s.project_id = ${projectId}
      AND s.identity_id != ${identityId}
      AND s.signal_hash LIKE ${hashPrefix + '%'}
      AND (
        ${clusterId}::uuid IS NULL
        OR i.cluster_id IS NULL
        OR i.cluster_id != ${clusterId}::uuid
      )
    LIMIT 20
  `;

  const count = rows.length;
  if (count < 2) return null;

  const confidence = Math.min(0.88, 0.50 + (count - 2) * 0.08);

  return {
    code: 'coordinated_behavior',
    label: 'Coordinated behavior',
    reason: `${count} other identities share near-identical stable signal hashes but different volatile signals`,
    confidence,
  };
}
