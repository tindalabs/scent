// Phase 1 will implement signal collection, persistence, and the observe() API.
// This stub defines the public interface so apps/demo can import and type-check.

export type {
  ScentObservation,
  ScentInitOptions,
  PersistencePolicy,
} from '@irregular/scent-engine';

import type { ScentObservation, ScentInitOptions } from '@irregular/scent-engine';

export class ScentSDK {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_options: ScentInitOptions) {}

  async observe(): Promise<ScentObservation> {
    throw new Error('Not implemented — Phase 1');
  }
}

export function init(options: ScentInitOptions): ScentSDK {
  return new ScentSDK(options);
}
