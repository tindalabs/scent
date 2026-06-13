import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectRapidReregistration } from './rapid-reregistration.js';

// Stub the single query with N distinct new-identity rows.
function mockSql(count: number): Sql {
  const rows = Array.from({ length: count }, (_, i) => ({ identity_id: `id-${i}` }));
  return (() => Promise.resolve(rows)) as unknown as Sql;
}

describe('detectRapidReregistration', () => {
  it('returns null below the 3-identity threshold', async () => {
    expect(await detectRapidReregistration(mockSql(0), 'p', '0123456789abcdef', 'cur')).toBeNull();
    expect(await detectRapidReregistration(mockSql(2), 'p', '0123456789abcdef', 'cur')).toBeNull();
  });

  it('flags at exactly 3 similar new identities', async () => {
    const flag = await detectRapidReregistration(mockSql(3), 'p', '0123456789abcdef', 'cur');
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('rapid_reregistration');
    expect(flag!.confidence).toBeCloseTo(0.45);
  });

  it('confidence rises with more identities and caps at 0.90', async () => {
    const five = await detectRapidReregistration(mockSql(5), 'p', '0123456789abcdef', 'cur');
    const many = await detectRapidReregistration(mockSql(20), 'p', '0123456789abcdef', 'cur');
    expect(five!.confidence).toBeGreaterThan(0.45);
    expect(many!.confidence).toBeLessThanOrEqual(0.9);
    expect(many!.confidence).toBeGreaterThanOrEqual(five!.confidence);
  });

  it('reason names the count and the window', async () => {
    const flag = await detectRapidReregistration(mockSql(4), 'p', '0123456789abcdef', 'cur', 30);
    expect(flag!.reason).toContain('4');
    expect(flag!.reason).toContain('30 minutes');
  });
});
