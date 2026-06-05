import type { RiskFlag } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// Flags a single Scent identity (one device/operator) linked to many distinct
// application accounts in a short window — the classic free-trial / multi-account
// abuse pattern. Unlike coordinated-behavior (which *infers* shared hardware from
// near-identical signal hashes), this works on explicit scent.identify() links, so
// it only fires once the application has called identify() with real account IDs.
//
// The rolling 30-day window keeps long-dormant associations from accumulating into
// a false positive years later.
export async function detectCoordinatedAccounts(
  sql: Sql,
  projectId: string,
  identityId: string,
): Promise<RiskFlag | null> {
  const [row] = await sql<{ account_count: number }[]>`
    SELECT COUNT(DISTINCT account_id)::int AS account_count
    FROM identity_account_links
    WHERE project_id = ${projectId}
      AND identity_id = ${identityId}
      AND last_linked_at >= now() - interval '30 days'
  `;

  const count = row?.account_count ?? 0;
  if (count < 3) return null;

  // 3 accounts → 0.55 (lands in the "high" band); each additional account adds
  // 0.10, capped at 0.90 so it never single-handedly forces a "critical" band.
  const confidence = Math.min(0.9, 0.55 + (count - 3) * 0.1);

  return {
    code: 'coordinated_accounts',
    label: 'Coordinated accounts',
    reason: `${count} distinct accounts linked to this identity within the last 30 days`,
    confidence,
  };
}
