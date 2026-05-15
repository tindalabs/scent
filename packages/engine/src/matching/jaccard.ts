import type { SignalMap } from '../types.js';
import { weightOf, decayMultiplier } from '../signals/weights.js';

export interface MatchResult {
  confidence: number;
  matchedSignals: string[];
  mismatchedSignals: string[];
  absentSignals: string[];
  toleratedSignals: string[];
}

export interface JaccardOptions {
  daysSinceLastObservation?: number;
  // Number of highest-weight mismatched signals to forgive. A signal is
  // "forgiven" by removing it from both sides of the Jaccard ratio —
  // its mismatch is treated as neutral rather than penalised.
  // Default: 1, because a single stable signal change (e.g. browser update
  // regenerating a canvas hash) is expected noise, not a different entity.
  toleratedMismatches?: number;
  // Per-signal weight overrides: { 'canvas.2d': 0.5 }. Overrides the
  // stability-class base weight for this specific comparison (enterprise hook).
  weightOverrides?: Record<string, number>;
}

// Weighted Jaccard similarity between two signal maps.
//
// The intersection weight is the sum of weights for keys that are present
// in both maps AND have the same value. The union weight is the sum of all
// unique key weights across both maps.
//
// daysSinceLastObservation applies time-decay to the stable signal weights.
// toleratedMismatches removes the top-N highest-weight mismatches from both
// sides of the ratio before scoring, so expected noise doesn't tank confidence.
export function weightedJaccard(
  incoming: SignalMap,
  stored: SignalMap,
  optionsOrDays: JaccardOptions | number = {},
): MatchResult {
  const opts: JaccardOptions =
    typeof optionsOrDays === 'number'
      ? { daysSinceLastObservation: optionsOrDays }
      : optionsOrDays;

  const days = opts.daysSinceLastObservation ?? 0;
  const tolerance = opts.toleratedMismatches ?? 1;
  const overrides = opts.weightOverrides ?? {};
  const decay = decayMultiplier(days);

  const allKeys = new Set([...Object.keys(incoming), ...Object.keys(stored)]);

  // First pass: classify all signals and compute their weights.
  const matchedSignals: string[] = [];
  const mismatchedWithWeight: Array<{ key: string; w: number }> = [];
  const absentSignals: string[] = [];

  let intersectionWeight = 0;
  let unionWeight = 0;

  for (const key of allKeys) {
    if (key.startsWith('tamper.')) continue;

    const baseWeight = overrides[key] ?? weightOf(key);
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
        mismatchedWithWeight.push({ key, w });
      }
    } else if (inPresent || stPresent) {
      unionWeight += w;
      absentSignals.push(key);
    }
  }

  // Second pass: apply tolerance. Sort mismatches descending by weight and
  // forgive the top N — remove their weight from both sides of the ratio.
  mismatchedWithWeight.sort((a, b) => b.w - a.w);
  const toleratedSignals: string[] = [];
  const mismatchedSignals: string[] = [];

  for (let i = 0; i < mismatchedWithWeight.length; i++) {
    const entry = mismatchedWithWeight[i];
    if (!entry) continue;
    if (i < tolerance) {
      toleratedSignals.push(entry.key);
      unionWeight -= entry.w;
    } else {
      mismatchedSignals.push(entry.key);
    }
  }

  const confidence = unionWeight > 0 ? intersectionWeight / unionWeight : 0;

  return {
    confidence: Math.min(1, confidence),
    matchedSignals,
    mismatchedSignals,
    absentSignals,
    toleratedSignals,
  };
}
