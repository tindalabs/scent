import type { RiskFlag } from '@tindalabs/scent-engine';
import { hexToSimHash, simHashToInt64, SIMHASH_CANDIDATE_THRESHOLD } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// Finds other identities in this project whose stable signal profile is near-identical
// to the current one but which are NOT already in the same cluster. The pattern: one
// device/operator with constant hardware cycling through volatile signals (VPN/UA
// rotation) to look like many users.
//
// Similarity is measured the same way as candidate matching: SimHash Hamming distance
// over the denormalized identities.latest_signal_hash (`bit_count(a # b)` within the
// shared SIMHASH_CANDIDATE_THRESHOLD), not a hex-prefix approximation. Identities
// already in the same cluster are excluded — they've been accounted for.
export async function detectCoordinatedBehavior(
  sql: Sql,
  projectId: string,
  identityId: string,
  signalHash: string,
  clusterId: string | null,
): Promise<RiskFlag | null> {
  const simHashInt = simHashToInt64(hexToSimHash(signalHash)).toString();

  const rows = await sql<{ id: string }[]>`
    SELECT i.id
    FROM identities i
    WHERE i.project_id = ${projectId}
      AND i.id != ${identityId}
      AND i.latest_signal_hash IS NOT NULL
      AND bit_count((i.latest_signal_hash # ${simHashInt}::bigint)::bit(64)) <= ${SIMHASH_CANDIDATE_THRESHOLD}
      AND (
        ${clusterId}::uuid IS NULL
        OR i.cluster_id IS NULL
        OR i.cluster_id != ${clusterId}::uuid
      )
    LIMIT 20
  `;

  const count = rows.length;
  if (count < 2) return null;

  const confidence = Math.min(0.88, 0.5 + (count - 2) * 0.08);

  return {
    code: 'coordinated_behavior',
    label: 'Coordinated behavior',
    reason: `${count} other identities share near-identical stable signal hashes but different volatile signals`,
    confidence,
  };
}
