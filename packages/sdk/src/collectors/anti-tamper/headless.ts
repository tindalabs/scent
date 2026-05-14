import { BaseCollector } from '../base.js';
import type { SignalRecord } from '../types.js';

export class HeadlessCollector extends BaseCollector {
  readonly name = 'anti-tamper.headless';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    // Headless Chrome historically had 0 plugins; real browsers have at least one
    const noPlugins = navigator.plugins.length === 0;

    // Headless environments often report screen dimensions inconsistent with
    // the viewport (window dimensions larger than reported screen)
    const screenInconsistent =
      window.outerWidth > screen.width || window.outerHeight > screen.height;

    // Chrome headless used to expose this non-standard property
    const chromeHeadless =
      /HeadlessChrome/.test(navigator.userAgent);

    // Permissions API behaves differently in headless — notification permission
    // is never "granted" without user interaction, but headless environments
    // sometimes report unexpected states
    return Promise.resolve({
      'tamper.no_plugins': noPlugins,
      'tamper.screen_inconsistent': screenInconsistent,
      'tamper.headless_chrome': chromeHeadless,
    });
  }
}
