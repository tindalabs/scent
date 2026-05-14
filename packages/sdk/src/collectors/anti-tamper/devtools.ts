import { BaseCollector } from '../base.js';
import type { SignalRecord } from '../types.js';

// DevTools presence is a risk signal, not a reason to block.
// We use the window size heuristic — DevTools docked to the side or bottom
// increases the difference between outer and inner window dimensions.
const DEVTOOLS_THRESHOLD = 160;

export class DevToolsCollector extends BaseCollector {
  readonly name = 'anti-tamper.devtools';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    const open = widthDiff > DEVTOOLS_THRESHOLD || heightDiff > DEVTOOLS_THRESHOLD;
    return Promise.resolve({ 'tamper.devtools_open': open });
  }
}
