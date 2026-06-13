import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectCoordinatedBehavior } from './coordinated-behavior.js';

function mockSql(count: number): Sql {
  const rows = Array.from({ length: count }, (_, i) => ({ identity_id: `id-${i}` }));
  return (() => Promise.resolve(rows)) as unknown as Sql;
}

describe('detectCoordinatedBehavior', () => {
  it('returns null below the 2-identity threshold', async () => {
    expect(await detectCoordinatedBehavior(mockSql(0), 'p', 'i', '0123456789abcdef', null)).toBeNull();
    expect(await detectCoordinatedBehavior(mockSql(1), 'p', 'i', '0123456789abcdef', null)).toBeNull();
  });

  it('flags at exactly 2 sibling identities', async () => {
    const flag = await detectCoordinatedBehavior(mockSql(2), 'p', 'i', '0123456789abcdef', null);
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('coordinated_behavior');
    expect(flag!.confidence).toBeCloseTo(0.5);
  });

  it('confidence rises with more siblings and caps at 0.88', async () => {
    const many = await detectCoordinatedBehavior(mockSql(20), 'p', 'i', '0123456789abcdef', 'cluster-1');
    expect(many!.confidence).toBeLessThanOrEqual(0.88);
    expect(many!.confidence).toBeGreaterThan(0.5);
  });
});
