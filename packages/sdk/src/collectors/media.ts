import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class MediaCollector extends BaseCollector {
  readonly name = 'media';
  readonly stabilityClass = 'moderate' as const;

  collect(): Promise<SignalRecord> {
    return Promise.resolve({
      'media.dark_mode': window.matchMedia('(prefers-color-scheme: dark)').matches,
      'media.reduced_motion': window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      'media.hdr': window.matchMedia('(dynamic-range: high)').matches,
    });
  }
}
