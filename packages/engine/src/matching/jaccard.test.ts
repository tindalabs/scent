import { describe, it, expect } from 'vitest';
import { weightedJaccard } from './jaccard.js';

const SIGNALS_A = {
  'canvas.2d': 'abc123',
  'audio.hash': '9876',
  'fonts.list': 'Arial,Helvetica',
  'screen.width': 1920,
  'locale.timezone': 'Europe/Madrid',
  'network.type': '4g',
};

describe('weightedJaccard', () => {
  it('returns confidence 1.0 for identical signal maps', () => {
    const { confidence } = weightedJaccard(SIGNALS_A, { ...SIGNALS_A });
    expect(confidence).toBeCloseTo(1.0);
  });

  it('returns confidence 0 for completely disjoint signal maps', () => {
    const other = {
      'canvas.2d': 'zzz999',
      'audio.hash': '1111',
      'fonts.list': 'Comic Sans',
      'screen.width': 800,
      'locale.timezone': 'Asia/Tokyo',
      'network.type': 'wifi',
    };
    const { confidence } = weightedJaccard(SIGNALS_A, other);
    // With tolerance=1 (default), the highest-weight mismatch (canvas.2d)
    // is forgiven, but all other signals still mismatch → near zero.
    expect(confidence).toBeLessThan(0.1);
  });

  it('returns high confidence when only volatile signals differ', () => {
    const drifted = { ...SIGNALS_A, 'network.type': 'wifi' };
    const { confidence } = weightedJaccard(SIGNALS_A, drifted);
    expect(confidence).toBeGreaterThan(0.85);
  });

  it('returns lower confidence when a stable signal changes (tolerance=0)', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different_hash' };
    const { confidence, mismatchedSignals } = weightedJaccard(SIGNALS_A, drifted, {
      toleratedMismatches: 0,
    });
    expect(confidence).toBeLessThan(0.85);
    expect(mismatchedSignals).toContain('canvas.2d');
  });

  it('tolerates a single stable signal mismatch with default tolerance=1', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different_hash' };
    const { confidence, toleratedSignals, mismatchedSignals } = weightedJaccard(
      SIGNALS_A,
      drifted,
    );
    // canvas.2d is the highest-weight mismatch → forgiven by default tolerance
    expect(toleratedSignals).toContain('canvas.2d');
    expect(mismatchedSignals).not.toContain('canvas.2d');
    expect(confidence).toBeCloseTo(1.0);
  });

  it('does not tolerate two stable signal mismatches with tolerance=1', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different', 'audio.hash': 'different' };
    const { confidence, toleratedSignals } = weightedJaccard(SIGNALS_A, drifted);
    // Only the highest-weight mismatch is forgiven; the second still penalises.
    expect(toleratedSignals).toHaveLength(1);
    expect(confidence).toBeLessThan(0.95);
  });

  it('respects custom toleratedMismatches=2', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different', 'audio.hash': 'different' };
    const { confidence, toleratedSignals } = weightedJaccard(SIGNALS_A, drifted, {
      toleratedMismatches: 2,
    });
    expect(toleratedSignals).toHaveLength(2);
    expect(confidence).toBeCloseTo(1.0);
  });

  it('respects weightOverrides', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different_hash' };
    // With tolerance=0 and canvas weight lowered to 0.1, mismatch barely moves score
    const { confidence } = weightedJaccard(SIGNALS_A, drifted, {
      toleratedMismatches: 0,
      weightOverrides: { 'canvas.2d': 0.1 },
    });
    expect(confidence).toBeGreaterThan(0.90);
  });

  it('tamper signals are excluded from scoring', () => {
    const withTamper = { ...SIGNALS_A, 'tamper.webdriver': true };
    const { confidence } = weightedJaccard(SIGNALS_A, withTamper);
    expect(confidence).toBeCloseTo(1.0);
  });

  it('accepts daysSinceLastObservation via legacy number signature', () => {
    const fresh = weightedJaccard(SIGNALS_A, { ...SIGNALS_A }, 0);
    const stale = weightedJaccard(SIGNALS_A, { ...SIGNALS_A }, 365);
    expect(fresh.confidence).toBeCloseTo(stale.confidence);
  });
});

describe('weightedJaccard — edge cases', () => {
  it('returns 0 confidence for two empty signal maps', () => {
    expect(weightedJaccard({}, {}).confidence).toBe(0);
  });

  it('returns 0 confidence when one side is empty', () => {
    expect(weightedJaccard(SIGNALS_A, {}).confidence).toBe(0);
    expect(weightedJaccard({}, SIGNALS_A).confidence).toBe(0);
  });

  it('treats null/undefined values as absent, not as a matching value', () => {
    const withNull = { ...SIGNALS_A, 'canvas.2d': null };
    const { matchedSignals, absentSignals } = weightedJaccard(SIGNALS_A, withNull, {
      toleratedMismatches: 0,
    });
    expect(matchedSignals).not.toContain('canvas.2d'); // present-vs-null is not a match
    expect(absentSignals).toContain('canvas.2d');
  });

  it('penalises a stable signal present on only one side (dilutes the union)', () => {
    const stored = { ...SIGNALS_A };
    const incoming = { ...SIGNALS_A, 'canvas.webgl': 'extra-stable-only-here' };
    const { confidence, absentSignals } = weightedJaccard(incoming, stored, {
      toleratedMismatches: 0,
    });
    expect(absentSignals).toContain('canvas.webgl');
    expect(confidence).toBeLessThan(1);
  });

  it('reports every identical key in matchedSignals', () => {
    const { matchedSignals } = weightedJaccard(SIGNALS_A, { ...SIGNALS_A });
    expect(matchedSignals).toEqual(expect.arrayContaining(Object.keys(SIGNALS_A)));
  });

  it('a single moderate-signal change dents confidence less than a stable one', () => {
    const moderateChanged = { ...SIGNALS_A, 'screen.width': 640 };
    const stableChanged = { ...SIGNALS_A, 'canvas.2d': 'different' };
    const mod = weightedJaccard(SIGNALS_A, moderateChanged, { toleratedMismatches: 0 });
    const stb = weightedJaccard(SIGNALS_A, stableChanged, { toleratedMismatches: 0 });
    expect(mod.mismatchedSignals).toContain('screen.width');
    expect(mod.confidence).toBeGreaterThan(stb.confidence); // moderate weight < stable weight
    expect(mod.confidence).toBeLessThan(1);
  });

  it('never exceeds 1.0', () => {
    expect(weightedJaccard(SIGNALS_A, { ...SIGNALS_A }).confidence).toBeLessThanOrEqual(1);
  });
});
