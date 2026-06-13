import type { RiskFlag } from '@tindalabs/scent-engine';
import { lookupAnonymizer, lookupAsn, type AnonymizerInfo, type AsnInfo } from '../ip-intel.js';

// Flags a client IP that belongs to an anonymizing or datacenter network — a strong
// fraud tell when paired with a residential-looking browser fingerprint. Authoritative
// source is the Anonymous-IP database (hosting / VPN / Tor / proxy); the ASN database
// enriches the reason. Both are optional: with neither configured, no signal is emitted
// (no naive ASN-name keyword guessing).
//
// The strongest applicable network type sets the confidence.
const NETWORK_TYPES: ReadonlyArray<{ key: keyof AnonymizerInfo; confidence: number; label: string }> = [
  { key: 'tor', confidence: 0.85, label: 'Tor exit node' },
  { key: 'publicProxy', confidence: 0.72, label: 'public proxy' },
  { key: 'residentialProxy', confidence: 0.68, label: 'residential proxy' },
  { key: 'hosting', confidence: 0.62, label: 'hosting/datacenter network' },
  { key: 'vpn', confidence: 0.55, label: 'anonymous VPN' },
  { key: 'anonymous', confidence: 0.5, label: 'anonymizing network' },
];

export async function detectAnonymizerIp(
  clientIp: string | null,
  // Injectable for tests; default to the real lookups.
  resolveAnon: (ip: string) => Promise<AnonymizerInfo | null> = lookupAnonymizer,
  resolveAsn: (ip: string) => Promise<AsnInfo | null> = lookupAsn,
): Promise<RiskFlag | null> {
  if (!clientIp) return null;

  const anon = await resolveAnon(clientIp);
  if (!anon) return null;

  const hit = NETWORK_TYPES.find((t) => anon[t.key]);
  if (!hit) return null;

  const asn = await resolveAsn(clientIp);
  const asnSuffix = asn?.org ? ` (AS${asn.asn ?? '?'} ${asn.org})` : '';

  return {
    code: 'anonymizer_ip',
    label: 'Anonymizing / datacenter network',
    reason: `Client IP is a ${hit.label}${asnSuffix}`,
    confidence: hit.confidence,
  };
}
