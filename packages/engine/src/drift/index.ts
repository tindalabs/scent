import type { SignalMap, DriftClassification } from '../types.js';
import { weightOf } from '../signals/weights.js';

export interface DriftResult {
  classification: DriftClassification;
  entropy: number;
  changedSignals: string[];
  addedSignals: string[];
  removedSignals: string[];
}

// Diff two signal maps and produce a DriftResult.
// "before" is the stored snapshot; "after" is the new incoming observation.
export function diffSnapshots(before: SignalMap, after: SignalMap): DriftResult {
  const changedSignals: string[] = [];
  const addedSignals: string[] = [];
  const removedSignals: string[] = [];

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (key.startsWith('tamper.')) continue;

    const bVal = before[key];
    const aVal = after[key];
    const bPresent = bVal !== undefined && bVal !== null;
    const aPresent = aVal !== undefined && aVal !== null;

    if (bPresent && aPresent) {
      if (String(bVal) !== String(aVal)) changedSignals.push(key);
    } else if (!bPresent && aPresent) {
      addedSignals.push(key);
    } else if (bPresent && !aPresent) {
      removedSignals.push(key);
    }
  }

  const entropy = computeEntropy(changedSignals, addedSignals, removedSignals);
  const classification = classifyDrift(changedSignals, addedSignals, removedSignals, entropy);

  return { classification, entropy, changedSignals, addedSignals, removedSignals };
}

// Entropy = weighted proportion of changed/absent signals out of total signal space.
function computeEntropy(
  changed: string[],
  _added: string[],
  removed: string[],
): number {
  const impacted = [...changed, ...removed];
  if (impacted.length === 0) return 0;

  const weightedChange = impacted.reduce((sum, key) => sum + weightOf(key), 0);
  // Normalise against the maximum possible entropy (all stable signals changed).
  const maxWeight = 64 * 0.9; // 64 stable signals at max weight
  return Math.min(1, weightedChange / maxWeight);
}

function classifyDrift(
  changed: string[],
  _added: string[],
  removed: string[],
  entropy: number,
): DriftClassification {
  const stableChanged = changed.filter((k) => weightOf(k) >= 0.8);
  const volatileOnly = changed.every((k) => weightOf(k) < 0.5);

  // Suspicious: many stable signals changed simultaneously, or added/removed
  // high-weight signals that suggest active anti-fingerprinting.
  if (stableChanged.length >= 3 || entropy > 0.4) return 'suspicious';

  // Significant: at least one stable signal changed (e.g. browser update, new GPU).
  if (stableChanged.length >= 1) return 'significant';

  // Moderate: several moderate-weight signals changed (e.g. new OS version).
  if (!volatileOnly && (changed.length + removed.length) >= 3) return 'moderate';

  // Minor: only volatile signals changed (network type, connection speed, etc.).
  return 'minor';
}
