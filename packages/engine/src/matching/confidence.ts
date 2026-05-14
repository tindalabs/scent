import type { ConfidenceBand, IdentityContinuity } from '../types.js';

// Map a raw Jaccard similarity score to a calibrated confidence band.
// Thresholds are tuned conservatively: false positives (claiming two
// different entities are the same) are more harmful than false negatives.
export function scoreToConfidenceBand(score: number): ConfidenceBand {
  if (score >= 0.85) return 'high';
  if (score >= 0.60) return 'medium';
  if (score >= 0.35) return 'low';
  return 'unknown';
}

export function scoreToIdentityContinuity(score: number): IdentityContinuity {
  if (score >= 0.85) return 'confirmed';
  if (score >= 0.60) return 'probable';
  if (score >= 0.35) return 'uncertain';
  return 'unknown';
}

// Maximum Hamming distance below which two SimHashes are considered candidates
// for full Jaccard comparison. At 64 bits this allows ~15% bit difference.
export const SIMHASH_CANDIDATE_THRESHOLD = 10;
