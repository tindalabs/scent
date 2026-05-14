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
    expect(confidence).toBeLessThan(0.1);
  });

  it('returns high confidence when only volatile signals differ', () => {
    const drifted = { ...SIGNALS_A, 'network.type': 'wifi' };
    const { confidence } = weightedJaccard(SIGNALS_A, drifted);
    // network.type is volatile (weight 0.15), so swapping it barely moves confidence.
    expect(confidence).toBeGreaterThan(0.85);
  });

  it('returns lower confidence when a stable signal changes', () => {
    const drifted = { ...SIGNALS_A, 'canvas.2d': 'different_hash' };
    const { confidence, mismatchedSignals } = weightedJaccard(SIGNALS_A, drifted);
    expect(confidence).toBeLessThan(0.85);
    expect(mismatchedSignals).toContain('canvas.2d');
  });

  it('tamper signals are excluded from scoring', () => {
    const withTamper = { ...SIGNALS_A, 'tamper.webdriver': true };
    const { confidence } = weightedJaccard(SIGNALS_A, withTamper);
    // tamper signals ignored, so confidence should still be near 1.0 for the stable set
    expect(confidence).toBeCloseTo(1.0);
  });

  it('accepts daysSinceLastObservation without crashing', () => {
    // Decay is applied uniformly, so it cancels in the Jaccard ratio —
    // the confidence value itself is invariant to the decay parameter.
    // The parameter is a hook for future per-signal decay strategies.
    const fresh = weightedJaccard(SIGNALS_A, { ...SIGNALS_A }, 0);
    const stale = weightedJaccard(SIGNALS_A, { ...SIGNALS_A }, 365);
    expect(fresh.confidence).toBeCloseTo(stale.confidence);
  });
});
