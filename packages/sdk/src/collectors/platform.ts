import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

// Prefer the structured User-Agent Client Hints API (where available) over parsing
// the raw UA string, which is being frozen/reduced by all major browsers.
export class PlatformCollector extends BaseCollector {
  readonly name = 'platform';
  readonly stabilityClass = 'moderate' as const;

  async collect(): Promise<SignalRecord> {
    const nav = navigator as Navigator & {
      userAgentData?: {
        platform: string;
        mobile: boolean;
        getHighEntropyValues(hints: string[]): Promise<{
          platform?: string;
          platformVersion?: string;
          architecture?: string;
          model?: string;
          uaFullVersion?: string;
        }>;
      };
    };

    if (nav.userAgentData) {
      const hints = await nav.userAgentData.getHighEntropyValues([
        'platform',
        'platformVersion',
        'architecture',
        'model',
      ]);
      return {
        'platform.os': hints.platform ?? nav.userAgentData.platform,
        'platform.os_version': hints.platformVersion ?? '',
        'platform.arch': hints.architecture ?? '',
        'platform.mobile': nav.userAgentData.mobile,
        'platform.model': hints.model ?? '',
      };
    }

    // Fallback: coarse OS detection from the raw UA string.
    // We deliberately avoid storing the raw UA — it's being frozen and is unreliable.
    const ua = navigator.userAgent;
    return {
      'platform.os': coarseOS(ua),
      'platform.mobile': /mobi|android/i.test(ua),
      'platform.vendor': navigator.vendor ?? '',
    };
  }
}

function coarseOS(ua: string): string {
  if (/windows nt 10/i.test(ua)) return 'Windows 10+';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/android (\d+)/i.test(ua)) return `Android ${(ua.match(/android (\d+)/i) ?? [])[1] ?? ''}`;
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}
