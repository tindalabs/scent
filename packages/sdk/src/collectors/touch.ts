import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class TouchCollector extends BaseCollector {
  readonly name = 'touch';
  readonly stabilityClass = 'stable' as const;

  collect(): Promise<SignalRecord> {
    const touchPoints = navigator.maxTouchPoints ?? 0;

    // pointer media query is more reliable than TouchEvent availability checks
    let pointerType: string;
    if (window.matchMedia('(pointer: fine)').matches) pointerType = 'fine';
    else if (window.matchMedia('(pointer: coarse)').matches) pointerType = 'coarse';
    else pointerType = 'none';

    return Promise.resolve({
      'input.touch_points': touchPoints,
      'input.pointer': pointerType,
    });
  }
}
