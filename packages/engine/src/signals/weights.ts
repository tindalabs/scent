import type { SignalMap } from '../types.js';

// Base weights by stability class, as specified in the ROADMAP signal weighting model.
// Weights are on a 0–1 scale where 1.0 = maximum contribution to confidence.
const STABLE_WEIGHT = 0.9;
const MODERATE_WEIGHT = 0.55;
const VOLATILE_WEIGHT = 0.15;

// Prefix-to-weight mapping. Keyed on the signal name prefix that identifies
// the collector (matches the keys in docs/signals.md).
const SIGNAL_WEIGHTS: Record<string, number> = {
  // Highly stable (canvas, audio, fonts, hardware)
  'canvas.': STABLE_WEIGHT,
  'audio.': STABLE_WEIGHT,
  'fonts.': STABLE_WEIGHT,
  'hardware.': STABLE_WEIGHT,
  // Moderately stable
  'screen.': MODERATE_WEIGHT,
  'locale.': MODERATE_WEIGHT,
  'platform.': MODERATE_WEIGHT,
  'plugins.': MODERATE_WEIGHT,
  'media.': MODERATE_WEIGHT,
  'input.': MODERATE_WEIGHT,
  // Volatile
  'network.': VOLATILE_WEIGHT,
  'tamper.': VOLATILE_WEIGHT,
};

export function weightOf(signalKey: string): number {
  for (const [prefix, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    if (signalKey.startsWith(prefix)) return weight;
  }
  // Unknown signal keys default to moderate weight.
  return MODERATE_WEIGHT;
}

// Returns a weight map for all signals present in the given SignalMap.
export function buildWeightMap(signals: SignalMap): Map<string, number> {
  const map = new Map<string, number>();
  for (const key of Object.keys(signals)) {
    map.set(key, weightOf(key));
  }
  return map;
}

// Time-decay multiplier: weight decays toward VOLATILE_WEIGHT as the gap
// between observations grows. Returns a multiplier in (0, 1].
// At 0 days: 1.0 (no decay). At 90 days: ~0.5. At 365 days: ~0.2.
export function decayMultiplier(daysSinceLastObservation: number): number {
  return Math.exp(-0.008 * daysSinceLastObservation);
}
