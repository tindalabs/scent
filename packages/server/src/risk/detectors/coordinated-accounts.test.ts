import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectCoordinatedAccounts } from './coordinated-accounts.js';

// Minimal tagged-template stub: ignores the query text and resolves to a single
// row carrying the distinct-account count we want to exercise. The detector issues
// exactly one query and reads `account_count`, so this is all it needs.
function mockSql(accountCount: number): Sql {
  return (() => Promise.resolve([{ account_count: accountCount }])) as unknown as Sql;
}

describe('detectCoordinatedAccounts', () => {
  it('returns null below the 3-account threshold', async () => {
    expect(await detectCoordinatedAccounts(mockSql(0), 'p', 'i')).toBeNull();
    expect(await detectCoordinatedAccounts(mockSql(2), 'p', 'i')).toBeNull();
  });

  it('flags at exactly 3 distinct accounts with high-band confidence', async () => {
    const flag = await detectCoordinatedAccounts(mockSql(3), 'p', 'i');
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('coordinated_accounts');
    expect(flag!.label).toBe('Coordinated accounts');
    expect(flag!.confidence).toBeCloseTo(0.55);
  });

  it('confidence rises with more accounts and caps at 0.9', async () => {
    const five = await detectCoordinatedAccounts(mockSql(5), 'p', 'i');
    const many = await detectCoordinatedAccounts(mockSql(50), 'p', 'i');
    expect(five!.confidence).toBeGreaterThan(0.55);
    expect(many!.confidence).toBeLessThanOrEqual(0.9);
    expect(many!.confidence).toBeGreaterThan(five!.confidence);
  });

  it('reason names the account count', async () => {
    const flag = await detectCoordinatedAccounts(mockSql(4), 'p', 'i');
    expect(flag!.reason).toContain('4');
  });

  it('treats a missing count row as zero (no flag)', async () => {
    const emptySql = (() => Promise.resolve([])) as unknown as Sql;
    expect(await detectCoordinatedAccounts(emptySql, 'p', 'i')).toBeNull();
  });
});
