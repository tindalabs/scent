import { describe, it, expect } from 'vitest';
import { compositeRiskScore, scoreToRiskBand } from './scorer.js';

describe('compositeRiskScore', () => {
  it('returns 0 for no flags', () => {
    expect(compositeRiskScore([])).toBe(0);
  });

  it('returns single flag confidence for one flag', () => {
    const score = compositeRiskScore([
      { code: 'x', label: 'x', reason: 'x', confidence: 0.7 },
    ]);
    expect(score).toBeCloseTo(0.7);
  });

  it('combines two flags via probabilistic OR (higher than either alone)', () => {
    const score = compositeRiskScore([
      { code: 'a', label: 'a', reason: 'a', confidence: 0.5 },
      { code: 'b', label: 'b', reason: 'b', confidence: 0.5 },
    ]);
    // P = 1 - (1-0.5)(1-0.5) = 0.75
    expect(score).toBeCloseTo(0.75);
  });

  it('never exceeds 1.0', () => {
    const flags = Array(10).fill({ code: 'x', label: 'x', reason: 'x', confidence: 0.9 });
    expect(compositeRiskScore(flags)).toBeLessThanOrEqual(1.0);
  });
});

describe('scoreToRiskBand', () => {
  it('maps scores to correct bands', () => {
    expect(scoreToRiskBand(0.0)).toBe('low');
    expect(scoreToRiskBand(0.29)).toBe('low');
    expect(scoreToRiskBand(0.30)).toBe('medium');
    expect(scoreToRiskBand(0.54)).toBe('medium');
    expect(scoreToRiskBand(0.55)).toBe('high');
    expect(scoreToRiskBand(0.79)).toBe('high');
    expect(scoreToRiskBand(0.80)).toBe('critical');
    expect(scoreToRiskBand(1.00)).toBe('critical');
  });
});
