import { weightOf } from '@tindalabs/scent-engine';
import type { SignalMap } from '@tindalabs/scent-engine';

interface SignalEntry {
  consecutiveAbsences: number;
  lastSeen: string;
}

export type SignalProfile = Record<string, SignalEntry>;

// Returns per-signal weight overrides derived from absence history.
// A signal absent for 3+ consecutive observations is down-weighted by half;
// 6+ cuts it to a quarter. This prevents stale stable signals from unfairly
// penalising a returning identity whose browser stopped reporting that API.
export function absenceWeightOverrides(profile: SignalProfile): Record<string, number> {
  const overrides: Record<string, number> = {};

  for (const [key, entry] of Object.entries(profile)) {
    const absences = entry.consecutiveAbsences;
    if (absences >= 6) {
      overrides[key] = weightOf(key) * 0.25;
    } else if (absences >= 3) {
      overrides[key] = weightOf(key) * 0.5;
    }
  }

  return overrides;
}

// Produce an updated signal profile given the new incoming signals.
export function updateSignalProfile(
  existing: SignalProfile,
  incoming: SignalMap,
  timestamp: string,
): SignalProfile {
  const safe = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const updated: SignalProfile = { ...safe };

  for (const key of Object.keys(updated)) {
    const val = incoming[key];
    const present = val !== undefined && val !== null;
    const prev = updated[key];
    updated[key] = present
      ? { consecutiveAbsences: 0, lastSeen: timestamp }
      : {
          consecutiveAbsences: (prev?.consecutiveAbsences ?? 0) + 1,
          lastSeen: prev?.lastSeen ?? timestamp,
        };
  }

  for (const key of Object.keys(incoming)) {
    const val = incoming[key];
    if (val !== null && val !== undefined && !updated[key]) {
      updated[key] = { consecutiveAbsences: 0, lastSeen: timestamp };
    }
  }

  return updated;
}
