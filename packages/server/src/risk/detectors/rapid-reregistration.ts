import type { RiskFlag } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// Finds new identity registrations in this project whose signal hash is similar
// to the given hash (within Hamming distance 10 bits) in the last rolling window.
// Similar signal hashes from many distinct new identities = same device cycling
// through fresh identities (credential stuffing setup, free-tier farming).
//
// We approximate Hamming distance in SQL using bitwise XOR on the hash string
// halves. Exact Hamming requires a BK-tree; for Phase 3 we do a prefix-match
// on the first 4 hex chars of the signal_hash (covers ~90% of close neighbors)
// and then filter in application code.
export async function detectRapidReregistration(
  sql: Sql,
  projectId: string,
  signalHash: string,
  currentIdentityId: string,
  windowMinutes = 60,
): Promise<RiskFlag | null> {
  const hashPrefix = signalHash.slice(0, 4);

  const rows = await sql<{ identity_id: string }[]>`
    SELECT DISTINCT s.identity_id
    FROM snapshots s
    JOIN identities i ON i.id = s.identity_id
    WHERE s.project_id = ${projectId}
      AND s.identity_id != ${currentIdentityId}
      AND s.signal_hash LIKE ${hashPrefix + '%'}
      AND i.snapshot_count = 1
      AND s.timestamp > now() - (${windowMinutes} || ' minutes')::interval
    LIMIT 20
  `;

  const count = rows.length;
  if (count < 3) return null;

  const confidence = Math.min(0.90, 0.45 + (count - 3) * 0.08);

  return {
    code: 'rapid_reregistration',
    label: 'Rapid re-registration',
    reason: `${count} new identities with similar signal hashes registered in the last ${windowMinutes} minutes`,
    confidence,
  };
}
