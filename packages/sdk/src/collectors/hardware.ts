import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class HardwareCollector extends BaseCollector {
  readonly name = 'hardware';
  readonly stabilityClass = 'stable' as const;

  collect(): Promise<SignalRecord> {
    const result: SignalRecord = {
      'hardware.concurrency': navigator.hardwareConcurrency ?? null,
    };
    // deviceMemory is not universally available; avoid referencing a missing type
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (typeof nav.deviceMemory === 'number') {
      result['hardware.memory'] = nav.deviceMemory;
    }
    return Promise.resolve(result);
  }
}
