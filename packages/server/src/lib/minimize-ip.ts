// Network-truncates a client IP for storage at rest (ADR-0004 data minimisation).
// A /24 (IPv4) or /48 (IPv6) prefix still resolves to a city for impossible-travel
// detection while dropping the host-identifying bits, so it is the minimisation that
// preserves the risk signals. The FULL IP is still used transiently in the request
// path (e.g. the anonymizer detector); only what is persisted is minimised.
//
// `storeFull` (a per-project setting, default false) keeps the full address for
// operators with a documented lawful basis. Unrecognised inputs return null rather
// than storing something we can't reason about.
export function minimizeIp(ip: string | null | undefined, storeFull: boolean): string | null {
  if (!ip) return null;
  if (storeFull) return ip;

  // IPv4 → zero the last octet (/24).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const octets = ip.split('.');
    octets[3] = '0';
    return octets.join('.');
  }

  // IPv6 → keep the first three hextets (/48), drop the rest. Handles "::" compression
  // by taking only the groups before it (the high bits we keep live there).
  if (ip.includes(':')) {
    const head = ip.split('%')[0]!.split('::')[0]!; // strip zone id, take pre-"::" part
    const groups = head.split(':').filter(Boolean).slice(0, 3);
    while (groups.length < 3) groups.push('0');
    return `${groups.join(':')}::`;
  }

  return null;
}
