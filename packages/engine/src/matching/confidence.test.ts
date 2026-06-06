import { describe, it, expect } from 'vitest';
import {
  scoreToConfidenceBand,
  scoreToIdentityContinuity,
  SIMHASH_CANDIDATE_THRESHOLD,
} from './confidence.js';

// The 0.85 / 0.60 / 0.35 cutoffs are the calibration that turns a raw Jaccard
// score into the resolution verdict, so they're worth pinning at the boundaries.

describe('scoreToConfidenceBand', () => {
  it('maps scores to bands at the documented cutoffs (inclusive lower bounds)', () => {
    expect(scoreToConfidenceBand(1)).toBe('high');
    expect(scoreToConfidenceBand(0.85)).toBe('high');
    expect(scoreToConfidenceBand(0.8499)).toBe('medium');
    expect(scoreToConfidenceBand(0.6)).toBe('medium');
    expect(scoreToConfidenceBand(0.5999)).toBe('low');
    expect(scoreToConfidenceBand(0.35)).toBe('low');
    expect(scoreToConfidenceBand(0.3499)).toBe('unknown');
    expect(scoreToConfidenceBand(0)).toBe('unknown');
  });
});

describe('scoreToIdentityContinuity', () => {
  it('maps scores to continuity at the documented cutoffs (inclusive lower bounds)', () => {
    expect(scoreToIdentityContinuity(1)).toBe('confirmed');
    expect(scoreToIdentityContinuity(0.85)).toBe('confirmed');
    expect(scoreToIdentityContinuity(0.8499)).toBe('probable');
    expect(scoreToIdentityContinuity(0.6)).toBe('probable');
    expect(scoreToIdentityContinuity(0.5999)).toBe('uncertain');
    expect(scoreToIdentityContinuity(0.35)).toBe('uncertain');
    expect(scoreToIdentityContinuity(0.3499)).toBe('unknown');
    expect(scoreToIdentityContinuity(0)).toBe('unknown');
  });

  it('shares its cutoffs with scoreToConfidenceBand (the two must stay aligned)', () => {
    const bandRank = { unknown: 0, low: 1, medium: 2, high: 3 } as const;
    const contRank = { unknown: 0, uncertain: 1, probable: 2, confirmed: 3 } as const;
    for (const s of [0, 0.34, 0.35, 0.59, 0.6, 0.84, 0.85, 1]) {
      expect(bandRank[scoreToConfidenceBand(s)]).toBe(contRank[scoreToIdentityContinuity(s)]);
    }
  });
});

describe('SIMHASH_CANDIDATE_THRESHOLD', () => {
  it('is the documented 10-bit (~15% of 64) candidate cutoff', () => {
    expect(SIMHASH_CANDIDATE_THRESHOLD).toBe(10);
  });
});
