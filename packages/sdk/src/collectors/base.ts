import type { SignalCollector, SignalRecord, StabilityClass } from './types.js';

export abstract class BaseCollector implements SignalCollector {
  abstract readonly name: string;
  abstract readonly stabilityClass: StabilityClass;
  abstract collect(): Promise<SignalRecord>;

  // Runs collect(), returns empty record if the collector throws or the
  // environment doesn't support the required APIs. Never rejects.
  async safeCollect(): Promise<SignalRecord> {
    try {
      return await this.collect();
    } catch {
      return {};
    }
  }
}
