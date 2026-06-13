import { open, type Reader, type CityResponse } from 'maxmind';
import { logger } from '../logger.js';

export interface Coords {
  lat: number;
  lon: number;
}

// GeoIP is optional. Point GEOIP_DB_PATH at a City-level MaxMind/DB-IP `.mmdb`
// (it must carry lat/lon — a Country DB won't work) to enable location-based
// detectors. When unset or unreadable, lookups return null and the dependent
// signal (impossible travel) is simply not emitted.
let readerPromise: Promise<Reader<CityResponse> | null> | undefined;

function loadReader(): Promise<Reader<CityResponse> | null> {
  if (readerPromise) return readerPromise;
  const path = process.env['GEOIP_DB_PATH'];
  if (!path) {
    readerPromise = Promise.resolve(null);
    return readerPromise;
  }
  readerPromise = open<CityResponse>(path)
    .then((reader) => {
      logger.info({ path }, 'GeoIP database loaded');
      return reader;
    })
    .catch((err: unknown) => {
      logger.warn({ err, path }, 'GeoIP database not loaded; location signals disabled');
      return null;
    });
  return readerPromise;
}

// Resolve an IP to coordinates, or null if GeoIP is disabled, the IP is
// private/reserved/unroutable, or the DB has no location for it.
export async function lookupCoords(ip: string): Promise<Coords | null> {
  const reader = await loadReader();
  if (!reader) return null;
  let record: CityResponse | null;
  try {
    record = reader.get(ip);
  } catch {
    return null; // malformed IP
  }
  const lat = record?.location?.latitude;
  const lon = record?.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lon };
}

// Great-circle distance in kilometres between two coordinates.
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371; // mean Earth radius, km
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Test seam: reset the cached reader so GEOIP_DB_PATH can be re-read.
export function _resetGeoIpForTests(): void {
  readerPromise = undefined;
}
