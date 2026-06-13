import { open, type Reader, type Response, type AsnResponse, type AnonymousIPResponse } from 'maxmind';
import { logger } from '../logger.js';

// Optional IP-intelligence databases, loaded lazily from env-configured paths.
// Same pattern as geoip.ts: absent/unreadable -> lookups return null and the
// dependent signal is simply not emitted.
//   GEOIP_ASN_DB_PATH        -> ASN database (e.g. GeoLite2-ASN, free)
//   GEOIP_ANONYMOUS_DB_PATH  -> Anonymous-IP database (hosting/VPN/Tor/proxy flags)
function lazyReader<T extends Response>(envVar: string): { get: () => Promise<Reader<T> | null>; reset: () => void } {
  let p: Promise<Reader<T> | null> | undefined;
  return {
    get(): Promise<Reader<T> | null> {
      if (p) return p;
      const path = process.env[envVar];
      if (!path) {
        p = Promise.resolve(null);
        return p;
      }
      p = open<T>(path)
        .then((r) => {
          logger.info({ path, db: envVar }, 'IP-intel database loaded');
          return r;
        })
        .catch((err: unknown) => {
          logger.warn({ err, path, db: envVar }, 'IP-intel database not loaded; signal disabled');
          return null;
        });
      return p;
    },
    reset(): void {
      p = undefined;
    },
  };
}

const asnReader = lazyReader<AsnResponse>('GEOIP_ASN_DB_PATH');
const anonReader = lazyReader<AnonymousIPResponse>('GEOIP_ANONYMOUS_DB_PATH');

export interface AsnInfo {
  asn: number | null;
  org: string | null;
}

export async function lookupAsn(ip: string): Promise<AsnInfo | null> {
  const reader = await asnReader.get();
  if (!reader) return null;
  let rec: AsnResponse | null;
  try {
    rec = reader.get(ip);
  } catch {
    return null;
  }
  if (!rec) return null;
  return {
    asn: rec.autonomous_system_number ?? null,
    org: rec.autonomous_system_organization ?? null,
  };
}

export interface AnonymizerInfo {
  hosting: boolean;
  vpn: boolean;
  tor: boolean;
  publicProxy: boolean;
  residentialProxy: boolean;
  anonymous: boolean;
}

export async function lookupAnonymizer(ip: string): Promise<AnonymizerInfo | null> {
  const reader = await anonReader.get();
  if (!reader) return null;
  let rec: AnonymousIPResponse | null;
  try {
    rec = reader.get(ip);
  } catch {
    return null;
  }
  if (!rec) return null; // not in the anonymizer DB -> not flagged
  return {
    hosting: rec.is_hosting_provider ?? false,
    vpn: rec.is_anonymous_vpn ?? false,
    tor: rec.is_tor_exit_node ?? false,
    publicProxy: rec.is_public_proxy ?? false,
    residentialProxy: rec.is_residential_proxy ?? false,
    anonymous: rec.is_anonymous ?? false,
  };
}

// Test seam: reset cached readers so env paths can be re-read.
export function _resetIpIntelForTests(): void {
  asnReader.reset();
  anonReader.reset();
}
