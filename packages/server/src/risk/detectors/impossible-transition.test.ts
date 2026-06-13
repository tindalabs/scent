import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectImpossibleTransition } from './impossible-transition.js';
import type { Coords } from '../geoip.js';

// Stub the single "previous snapshot" query.
function mockSql(rows: Array<{ client_ip: string | null; timestamp: Date }>): Sql {
  return (() => Promise.resolve(rows)) as unknown as Sql;
}
const NO_PREV = mockSql([]);

// Geo fixtures.
const LONDON: Coords = { lat: 51.5074, lon: -0.1278 };
const PARIS: Coords = { lat: 48.8566, lon: 2.3522 }; // ~343 km from London (< MIN_DISTANCE_KM)
const NEW_YORK: Coords = { lat: 40.7128, lon: -74.006 }; // ~5570 km from London

// Injectable coord resolver mapping IP -> coords (null = unlocatable / GeoIP off).
const resolver =
  (map: Record<string, Coords>) =>
  (ip: string): Promise<Coords | null> =>
    Promise.resolve(map[ip] ?? null);

const CUR = '2026-01-01T05:00:00.000Z';
const prevAt = (ip: string, hoursBefore: number): Sql =>
  mockSql([{ client_ip: ip, timestamp: new Date(Date.parse(CUR) - hoursBefore * 3_600_000) }]);

describe('detectImpossibleTransition', () => {
  it('returns null when the current IP is missing', async () => {
    expect(await detectImpossibleTransition(NO_PREV, 'i', null, CUR, resolver({}))).toBeNull();
  });

  it('returns null when GeoIP cannot locate the current IP', async () => {
    // resolver returns null for everything (GeoIP disabled / private / unknown IP)
    expect(await detectImpossibleTransition(prevAt('5.5.5.5', 1), 'i', '8.8.8.8', CUR, resolver({}))).toBeNull();
  });

  it('returns null with no prior located snapshot', async () => {
    const r = resolver({ '8.8.8.8': LONDON });
    expect(await detectImpossibleTransition(NO_PREV, 'i', '8.8.8.8', CUR, r)).toBeNull();
  });

  it('returns null when the prior IP cannot be located', async () => {
    const r = resolver({ '8.8.8.8': LONDON }); // prev '5.5.5.5' unlocatable
    expect(await detectImpossibleTransition(prevAt('5.5.5.5', 1), 'i', '8.8.8.8', CUR, r)).toBeNull();
  });

  it('returns null for a short distance even within a small window (GeoIP jitter floor)', async () => {
    const r = resolver({ cur: PARIS, prev: LONDON }); // ~343 km < 500
    const sql = mockSql([{ client_ip: 'prev', timestamp: new Date(Date.parse(CUR) - 0.1 * 3_600_000) }]);
    expect(await detectImpossibleTransition(sql, 'i', 'cur', CUR, r)).toBeNull();
  });

  it('flags a long distance covered faster than a flight (<plausible time)', async () => {
    const r = resolver({ cur: NEW_YORK, prev: LONDON }); // ~5570 km
    const flag = await detectImpossibleTransition(prevAt('prev', 1), 'i', 'cur', CUR, r); // 1h -> ~5570 km/h
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('impossible_transition');
    expect(flag!.confidence).toBeGreaterThan(0.6);
    expect(flag!.confidence).toBeLessThanOrEqual(0.95);
    expect(flag!.reason).toMatch(/km\/h/);
  });

  it('returns null when the same long distance is covered over a plausible time', async () => {
    const r = resolver({ cur: NEW_YORK, prev: LONDON }); // ~5570 km
    expect(await detectImpossibleTransition(prevAt('prev', 10), 'i', 'cur', CUR, r)).toBeNull(); // 10h -> ~557 km/h
  });

  it('caps confidence near-teleport', async () => {
    const r = resolver({ cur: NEW_YORK, prev: LONDON });
    // equal timestamps -> elapsed floored to 1 min -> astronomic implied speed
    const sql = mockSql([{ client_ip: 'prev', timestamp: new Date(CUR) }]);
    const flag = await detectImpossibleTransition(sql, 'i', 'cur', CUR, r);
    expect(flag!.confidence).toBeCloseTo(0.95);
  });
});
