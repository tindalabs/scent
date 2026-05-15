import type { RiskFlag } from '@irregular/scent-engine';
import type { Sql } from 'postgres';

// An identity whose signal profile changes dramatically on *every* observation
// is almost certainly running an anti-fingerprinting tool or rotating through
// virtual environments. Real users drift occasionally; tools drift constantly.
export async function detectEntropyInstability(
  sql: Sql,
  identityId: string,
): Promise<RiskFlag | null> {
  const drifts = await sql<{ entropy: number; classification: string }[]>`
    SELECT entropy, classification
    FROM drifts
    WHERE identity_id = ${identityId}
    ORDER BY timestamp DESC
    LIMIT 10
  `;

  if (drifts.length < 3) return null;

  const mean = drifts.reduce((s, d) => s + Number(d.entropy), 0) / drifts.length;
  const suspiciousCount = drifts.filter((d) => d.classification === 'suspicious').length;

  // Flag if entropy is consistently high OR if the majority of recent drifts
  // were classified as suspicious (which already accounts for stable-signal churn).
  if (mean < 0.25 && suspiciousCount < 2) return null;

  const confidence = Math.min(0.95, mean * 1.5 + suspiciousCount * 0.12);

  return {
    code: 'entropy_instability',
    label: 'Entropy instability',
    reason: `Mean drift entropy ${mean.toFixed(3)} across last ${drifts.length} observations; ${suspiciousCount} classified as suspicious`,
    confidence,
  };
}
