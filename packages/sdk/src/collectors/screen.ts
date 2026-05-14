import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class ScreenCollector extends BaseCollector {
  readonly name = 'screen';
  readonly stabilityClass = 'moderate' as const;

  collect(): Promise<SignalRecord> {
    const s = screen;
    return Promise.resolve({
      'screen.width': s.width,
      'screen.height': s.height,
      'screen.avail_width': s.availWidth,
      'screen.avail_height': s.availHeight,
      'screen.color_depth': s.colorDepth,
      'screen.dpr': window.devicePixelRatio ?? 1,
    });
  }
}
