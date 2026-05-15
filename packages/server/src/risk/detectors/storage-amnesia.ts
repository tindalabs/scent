import type { RiskFlag } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// An identity that keeps arriving as "new" (different SDK-generated IDs) but
// whose signals keep resolving to the same server-side identity is actively
// clearing storage between sessions. Aggressive private-mode cycling or
// deliberate cookie deletion to reset free-tier accounts is the canonical pattern.
//
// We detect this by counting how many distinct event_id prefixes (i.e. distinct
// SDK-assigned identityIds) resolved to this identity in the last 24 hours.
// A real user's identity token survives in at least one storage layer; a user
// deliberately resetting storage produces a new token every session.
export async function detectStorageAmnesia(
  sql: Sql,
  identityId: string,
): Promise<RiskFlag | null> {
  const rows = await sql<{ distinct_sdk_ids: number }[]>`
    SELECT COUNT(DISTINCT split_part(event_id, ':', 1)) AS distinct_sdk_ids
    FROM snapshots
    WHERE identity_id = ${identityId}
      AND timestamp > now() - interval '24 hours'
  `;

  const count = Number(rows[0]?.distinct_sdk_ids ?? 0);
  if (count < 3) return null;

  // Confidence scales with how many distinct SDK IDs resolved to this identity.
  // 3 resets = low confidence; 7+ = near-certain intentional clearing.
  const confidence = Math.min(0.90, 0.40 + (count - 3) * 0.10);

  return {
    code: 'storage_amnesia',
    label: 'Storage amnesia',
    reason: `${count} distinct SDK identity tokens resolved to this identity in the last 24 hours`,
    confidence,
  };
}
