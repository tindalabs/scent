import type { RiskFlag } from '@tindalabs/scent-engine';
import type { Sql } from 'postgres';
import { lookupCoords, haversineKm, type Coords } from '../geoip.js';

// "Impossible travel": the client IP's geographic location moved between two
// consecutive observations faster than is physically plausible. We geolocate both
// IPs (GeoIP), measure the great-circle distance, and divide by the elapsed time.
//
// Two guards keep this high-signal:
//   - MIN_DISTANCE_KM: below this, GeoIP city-level imprecision (tens of km) and
//     normal intra-region movement dominate — not worth flagging.
//   - MAX_PLAUSIBLE_SPEED_KMH: above commercial-jet cruise (~900 km/h) plus buffer.
//
// GeoIP is optional: if it's disabled or either IP can't be located (private,
// reserved, IPv6-local, or simply absent from the DB), no signal is emitted.
const MIN_DISTANCE_KM = 500;
const MAX_PLAUSIBLE_SPEED_KMH = 1000;
const MIN_GAP_HOURS = 1 / 60; // floor (1 min) so equal/clock-skewed timestamps don't divide by zero

export async function detectImpossibleTransition(
  sql: Sql,
  identityId: string,
  currentIp: string | null,
  currentTimestamp: string,
  // Injectable for tests; defaults to the real GeoIP lookup.
  resolveCoords: (ip: string) => Promise<Coords | null> = lookupCoords,
): Promise<RiskFlag | null> {
  if (!currentIp) return null;
  const current = await resolveCoords(currentIp);
  if (!current) return null;

  const prev = await sql<{ client_ip: string | null; timestamp: Date }[]>`
    SELECT client_ip, timestamp
    FROM snapshots
    WHERE identity_id = ${identityId} AND client_ip IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  const prevIp = prev[0]?.client_ip;
  if (!prevIp) return null;
  const previous = await resolveCoords(prevIp);
  if (!previous) return null;

  const distanceKm = haversineKm(current, previous);
  if (distanceKm < MIN_DISTANCE_KM) return null;

  const elapsedHours = Math.max(
    MIN_GAP_HOURS,
    (new Date(currentTimestamp).getTime() - prev[0]!.timestamp.getTime()) / 3_600_000,
  );
  const speedKmh = distanceKm / elapsedHours;
  if (speedKmh <= MAX_PLAUSIBLE_SPEED_KMH) return null;

  // Confidence grows with how far over the plausible-speed line we are.
  const confidence = Math.min(0.95, 0.6 + (speedKmh / MAX_PLAUSIBLE_SPEED_KMH - 1) * 0.1);

  return {
    code: 'impossible_transition',
    label: 'Impossible geographic transition',
    reason: `~${Math.round(distanceKm)} km in ${elapsedHours.toFixed(1)} h (~${Math.round(speedKmh)} km/h implied), exceeding plausible travel speed`,
    confidence,
  };
}
