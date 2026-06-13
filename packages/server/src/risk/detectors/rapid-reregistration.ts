import type { RiskFlag } from '@tindalabs/scent-engine';
import { hexToSimHash, simHashToInt64, SIMHASH_CANDIDATE_THRESHOLD } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// Finds freshly-registered identities in this project (snapshot_count = 1, first seen
// within the window) whose signal profile is near-identical to the current one. Many
// brand-new identities from effectively the same device = one operator cycling through
// fresh identities (credential-stuffing setup, free-tier farming).
//
// Similarity uses SimHash Hamming distance over identities.latest_signal_hash
// (`bit_count(a # b)` within SIMHASH_CANDIDATE_THRESHOLD) — the same measure as
// candidate matching, not a hex-prefix approximation.
export async function detectRapidReregistration(
  sql: Sql,
  projectId: string,
  signalHash: string,
  currentIdentityId: string,
  windowMinutes = 60,
): Promise<RiskFlag | null> {
  const simHashInt = simHashToInt64(hexToSimHash(signalHash)).toString();

  const rows = await sql<{ id: string }[]>`
    SELECT i.id
    FROM identities i
    WHERE i.project_id = ${projectId}
      AND i.id != ${currentIdentityId}
      AND i.snapshot_count = 1
      AND i.latest_signal_hash IS NOT NULL
      AND bit_count((i.latest_signal_hash # ${simHashInt}::bigint)::bit(64)) <= ${SIMHASH_CANDIDATE_THRESHOLD}
      AND i.first_seen > now() - (${windowMinutes} || ' minutes')::interval
    LIMIT 20
  `;

  const count = rows.length;
  if (count < 3) return null;

  const confidence = Math.min(0.9, 0.45 + (count - 3) * 0.08);

  return {
    code: 'rapid_reregistration',
    label: 'Rapid re-registration',
    reason: `${count} new identities with similar signal hashes registered in the last ${windowMinutes} minutes`,
    confidence,
  };
}
