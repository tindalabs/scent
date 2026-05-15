import type { RiskFlag } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';

// Geographic impossibility heuristic: compare the client IP of the current
// snapshot against the most recent prior snapshot for this identity.
// Without a geolocation API, we use IP /8 prefix as a rough regional proxy —
// different first octets across IPv4 space correlate strongly with different
// continents/regions for public IP ranges.
//
// The check only fires when:
//   - Both IPs are public IPv4 addresses
//   - The /8 subnets differ (different "regions")
//   - The time between observations is shorter than plausible travel time (2 hours)
export async function detectImpossibleTransition(
  sql: Sql,
  identityId: string,
  currentIp: string | null,
  currentTimestamp: string,
): Promise<RiskFlag | null> {
  if (!currentIp || !isPublicIpv4(currentIp)) return null;

  const prev = await sql<{ client_ip: string | null; timestamp: Date }[]>`
    SELECT client_ip, timestamp
    FROM snapshots
    WHERE identity_id = ${identityId}
      AND client_ip IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  if (!prev[0]?.client_ip || !isPublicIpv4(prev[0].client_ip)) return null;

  const currentOctet = firstOctet(currentIp);
  const prevOctet = firstOctet(prev[0].client_ip);

  if (currentOctet === prevOctet) return null;

  const gapMs = new Date(currentTimestamp).getTime() - new Date(prev[0].timestamp).getTime();
  const gapHours = gapMs / (1000 * 60 * 60);

  // Minimum plausible travel time between different /8 regions: 2 hours.
  if (gapHours >= 2) return null;

  const confidence = Math.min(0.85, 0.55 + Math.max(0, (2 - gapHours) * 0.15));

  return {
    code: 'impossible_transition',
    label: 'Impossible geographic transition',
    reason: `IP changed from /${prevOctet}.x.x.x to /${currentOctet}.x.x.x in ${gapHours.toFixed(1)} hours`,
    confidence,
  };
}

function isPublicIpv4(ip: string): boolean {
  // Very rough check: IPv4, not RFC-1918 private, not loopback
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const first = Number(parts[0]);
  if (isNaN(first)) return false;
  if (first === 10 || first === 127 || first === 172 || first === 192) return false;
  return true;
}

function firstOctet(ip: string): number {
  return Number(ip.split('.')[0]);
}
