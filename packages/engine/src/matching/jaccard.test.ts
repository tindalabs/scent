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
