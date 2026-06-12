import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectImpossibleTransition } from './impossible-transition.js';

// Stub the single "previous snapshot" query.
function mockSql(rows: Array<{ client_ip: string | null; timestamp: Date }>): Sql {
  return (() => Promise.resolve(rows)) as unknown as Sql;
}
const NO_PREV = mockSql([]);

const CUR = '2026-01-01T03:00:00.000Z';
const prevAt = (ip: string, minsBefore: number): Sql =>
  mockSql([{ client_ip: ip, timestamp: new Date(Date.parse(CUR) - minsBefore * 60_000) }]);

describe('detectImpossibleTransition', () => {
  it('returns null when the current IP is missing or private', async () => {
    expect(await detectImpossibleTransition(NO_PREV, 'i', null, CUR)).toBeNull();
    expect(await detectImpossibleTransition(NO_PREV, 'i', '10.0.0.1', CUR)).toBeNull();
    expect(await detectImpossibleTransition(NO_PREV, 'i', '192.168.1.5', CUR)).toBeNull();
  });

  it('returns null with no prior snapshot or a private prior IP', async () => {
    expect(await detectImpossibleTransition(NO_PREV, 'i', '8.8.8.8', CUR)).toBeNull();
    expect(await detectImpossibleTransition(prevAt('10.0.0.9', 30), 'i', '8.8.8.8', CUR)).toBeNull();
  });

  it('returns null when the region (/8) is unchanged', async () => {
    expect(await detectImpossibleTransition(prevAt('8.1.1.1', 30), 'i', '8.8.8.8', CUR)).toBeNull();
  });

  it('flags a different region reached faster than plausible travel (<2h)', async () => {
    const flag = await detectImpossibleTransition(prevAt('9.9.9.9', 30), 'i', '8.8.8.8', CUR);
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('impossible_transition');
    expect(flag!.confidence).toBeGreaterThan(0.55);
    expect(flag!.confidence).toBeLessThanOrEqual(0.85);
  });

  it('returns null when enough time has passed for the move (>=2h)', async () => {
    expect(await detectImpossibleTransition(prevAt('9.9.9.9', 180), 'i', '8.8.8.8', CUR)).toBeNull();
  });

  // Documents a known limitation of the rough heuristic: it treats ALL of 172.x and
  // 192.x as private, though only 172.16/12 and 192.168/16 actually are. Public
  // addresses in those /8s are therefore not evaluated. Captured so a future tightening
  // is a deliberate, test-visible change.
  it('does not evaluate 172.x / 192.x addresses (rough private-range heuristic)', async () => {
    expect(await detectImpossibleTransition(prevAt('9.9.9.9', 30), 'i', '172.32.0.1', CUR)).toBeNull();
  });
});
