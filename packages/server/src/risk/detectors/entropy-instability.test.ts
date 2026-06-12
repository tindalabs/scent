import { describe, it, expect } from 'vitest';
import type { Sql } from 'postgres';
import { detectEntropyInstability } from './entropy-instability.js';

// Stub the single drifts query with the rows we want to exercise.
function mockSql(rows: Array<{ entropy: number; classification: string }>): Sql {
  return (() => Promise.resolve(rows)) as unknown as Sql;
}

const drift = (entropy: number, classification = 'minor'): { entropy: number; classification: string } => ({
  entropy,
  classification,
});

describe('detectEntropyInstability', () => {
  it('returns null with fewer than 3 drifts (not enough history)', async () => {
    expect(await detectEntropyInstability(mockSql([]), 'i')).toBeNull();
    expect(await detectEntropyInstability(mockSql([drift(0.9), drift(0.9)]), 'i')).toBeNull();
  });

  it('returns null when entropy is low and few suspicious classifications', async () => {
    const rows = [drift(0.1), drift(0.05), drift(0.2)];
    expect(await detectEntropyInstability(mockSql(rows), 'i')).toBeNull();
  });

  it('flags when mean entropy is consistently high', async () => {
    const rows = [drift(0.6), drift(0.7), drift(0.5)];
    const flag = await detectEntropyInstability(mockSql(rows), 'i');
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('entropy_instability');
    expect(flag!.confidence).toBeGreaterThan(0);
  });

  it('flags on a majority of suspicious drifts even when mean entropy is low', async () => {
    const rows = [drift(0.1, 'suspicious'), drift(0.1, 'suspicious'), drift(0.1)];
    const flag = await detectEntropyInstability(mockSql(rows), 'i');
    expect(flag).not.toBeNull();
    expect(flag!.reason).toContain('2 classified as suspicious');
  });

  it('caps confidence at 0.95', async () => {
    const rows = Array.from({ length: 10 }, () => drift(1, 'suspicious'));
    const flag = await detectEntropyInstability(mockSql(rows), 'i');
    expect(flag!.confidence).toBeLessThanOrEqual(0.95);
  });
});
