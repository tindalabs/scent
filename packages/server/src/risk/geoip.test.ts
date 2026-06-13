import { describe, it, expect, afterEach } from 'vitest';
import { haversineKm, lookupCoords, _resetGeoIpForTests, type Coords } from './geoip.js';

const LONDON: Coords = { lat: 51.5074, lon: -0.1278 };
const PARIS: Coords = { lat: 48.8566, lon: 2.3522 };
const NEW_YORK: Coords = { lat: 40.7128, lon: -74.006 };

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(LONDON, LONDON)).toBeCloseTo(0, 5);
  });

  it('matches known city distances (±1%)', () => {
    expect(haversineKm(LONDON, PARIS)).toBeGreaterThan(330);
    expect(haversineKm(LONDON, PARIS)).toBeLessThan(355); // ~343 km
    expect(haversineKm(LONDON, NEW_YORK)).toBeGreaterThan(5500);
    expect(haversineKm(LONDON, NEW_YORK)).toBeLessThan(5640); // ~5570 km
  });

  it('is symmetric', () => {
    expect(haversineKm(LONDON, NEW_YORK)).toBeCloseTo(haversineKm(NEW_YORK, LONDON), 6);
  });
});

describe('lookupCoords', () => {
  afterEach(() => {
    delete process.env['GEOIP_DB_PATH'];
    _resetGeoIpForTests();
  });

  it('returns null when GeoIP is not configured (no GEOIP_DB_PATH)', async () => {
    delete process.env['GEOIP_DB_PATH'];
    _resetGeoIpForTests();
    expect(await lookupCoords('8.8.8.8')).toBeNull();
  });

  it('returns null (disabled) when the DB path is unreadable', async () => {
    process.env['GEOIP_DB_PATH'] = '/nonexistent/path/to/GeoLite2-City.mmdb';
    _resetGeoIpForTests();
    expect(await lookupCoords('8.8.8.8')).toBeNull();
  });
});
