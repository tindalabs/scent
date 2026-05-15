import type { RiskFlag, RiskBand } from '../types.js';

// Composite risk score from a set of active risk flags.
// Uses probabilistic OR: P(any risk) = 1 − ∏(1 − confidence_i).
// This correctly handles the case where multiple low-confidence flags
// combine to a higher overall score without linear double-counting.
export function compositeRiskScore(flags: RiskFlag[]): number {
  if (flags.length === 0) return 0;
  const score = 1 - flags.reduce((prod, f) => prod * (1 - f.confidence), 1);
  return Math.min(1, parseFloat(score.toFixed(4)));
}

export function scoreToRiskBand(score: number): RiskBand {
  if (score >= 0.80) return 'critical';
  if (score >= 0.55) return 'high';
  if (score >= 0.30) return 'medium';
  return 'low';
}
