import type { SignalMap } from '../types.js';
import { weightOf, decayMultiplier } from '../signals/weights.js';

export interface MatchResult {
  confidence: number;
  matchedSignals: string[];
  mismatchedSignals: string[];
  absentSignals: string[];
}

// Weighted Jaccard similarity between two signal maps.
//
// The intersection weight is the sum of weights for keys that are present
// in both maps AND have the same value. The union weight is the sum of all
// unique key weights across both maps. This is the standard weighted-set
// Jaccard formulation.
//
// daysSinceLastObservation applies time-decay to the stable signal weights,
// so an identity that hasn't been seen for months matches with lower confidence
// than one seen yesterday.
export function weightedJaccard(
  incoming: SignalMap,
  stored: SignalMap,
  daysSinceLastObservation = 0,
): MatchResult {
  const decay = decayMultiplier(daysSinceLastObservation);

  const allKeys = new Set([...Object.keys(incoming), ...Object.keys(stored)]);
  let intersectionWeight = 0;
  let unionWeight = 0;

  const matchedSignals: string[] = [];
  const mismatchedSignals: string[] = [];
  const absentSignals: string[] = [];

  for (const key of allKeys) {
    // Tamper signals are excluded from identity matching — they're inputs
    // to the risk engine, not to the identity continuity score.
    if (key.startsWith('tamper.')) continue;

    const baseWeight = weightOf(key);
    const w = baseWeight * decay;

    const inVal = incoming[key];
    const stVal = stored[key];

    const inPresent = inVal !== undefined && inVal !== null;
    const stPresent = stVal !== undefined && stVal !== null;

    if (inPresent && stPresent) {
      unionWeight += w;
      if (String(inVal) === String(stVal)) {
        intersectionWeight += w;
        matchedSignals.push(key);
      } else {
        mismatchedSignals.push(key);
      }
    } else if (inPresent || stPresent) {
      unionWeight += w;
      absentSignals.push(key);
    }
  }

  const similarity = unionWeight > 0 ? intersectionWeight / unionWeight : 0;

  return {
    confidence: similarity,
    matchedSignals,
    mismatchedSignals,
    absentSignals,
  };
}
