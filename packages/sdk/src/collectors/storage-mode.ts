import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

// Heuristic threshold for Chrome/Firefox private mode quota.
// Normal browsing gets GBs of quota; private mode is capped at a much smaller
// value (typically < 120 MB on most devices). Safari private mode throws on
// any localStorage write rather than returning a reduced quota.
const PRIVATE_QUOTA_THRESHOLD_BYTES = 120 * 1024 * 1024;

export class StorageModeCollector extends BaseCollector {
  readonly name = 'storage_mode';
  readonly stabilityClass = 'volatile' as const;

  async collect(): Promise<SignalRecord> {
    // Safari private mode: localStorage.setItem throws SecurityError
    try {
      const testKey = '__scent_sm';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
    } catch {
      return { 'storage.restricted': true };
    }

    // Chrome / Firefox private mode: Storage Manager quota is unusually small
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { quota } = await navigator.storage.estimate();
      if (typeof quota === 'number' && quota > 0 && quota < PRIVATE_QUOTA_THRESHOLD_BYTES) {
        return { 'storage.restricted': true };
      }
    }

    return { 'storage.restricted': false };
  }
}
