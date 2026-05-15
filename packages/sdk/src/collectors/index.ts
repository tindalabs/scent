export { BaseCollector } from './base.js';
export type { SignalCollector, SignalRecord, SignalValue, StabilityClass } from './types.js';

export { CanvasCollector } from './canvas.js';
export { AudioCollector } from './audio.js';
export { FontCollector } from './fonts.js';
export { ScreenCollector } from './screen.js';
export { LocaleCollector } from './locale.js';
export { HardwareCollector } from './hardware.js';
export { PlatformCollector } from './platform.js';
export { TouchCollector } from './touch.js';
export { NetworkCollector } from './network.js';
export { PluginCollector } from './plugins.js';
export { MediaCollector } from './media.js';

export { WebDriverCollector } from './anti-tamper/webdriver.js';
export { HeadlessCollector } from './anti-tamper/headless.js';
export { PatchedApiCollector } from './anti-tamper/patched-api.js';
export { DevToolsCollector } from './anti-tamper/devtools.js';
export { EntropySpoofCollector } from './anti-tamper/entropy-spoof.js';

import type { ScentInitOptions } from '@tindalabs/scent-engine';
import type { BaseCollector } from './base.js';
import { AudioCollector } from './audio.js';
import { CanvasCollector } from './canvas.js';
import { DevToolsCollector } from './anti-tamper/devtools.js';
import { EntropySpoofCollector } from './anti-tamper/entropy-spoof.js';
import { FontCollector } from './fonts.js';
import { HardwareCollector } from './hardware.js';
import { HeadlessCollector } from './anti-tamper/headless.js';
import { LocaleCollector } from './locale.js';
import { MediaCollector } from './media.js';
import { NetworkCollector } from './network.js';
import { PatchedApiCollector } from './anti-tamper/patched-api.js';
import { PlatformCollector } from './platform.js';
import { PluginCollector } from './plugins.js';
import { ScreenCollector } from './screen.js';
import { TouchCollector } from './touch.js';
import { WebDriverCollector } from './anti-tamper/webdriver.js';

export function buildCollectors(options: ScentInitOptions): BaseCollector[] {
  const collectors: BaseCollector[] = [
    new CanvasCollector(),
    new AudioCollector(),
    new FontCollector(),
    new ScreenCollector(),
    new LocaleCollector(),
    new HardwareCollector(),
    new PlatformCollector(),
    new TouchCollector(),
    new NetworkCollector(),
    new PluginCollector(),
    new MediaCollector(),
    new WebDriverCollector(),
    new HeadlessCollector(),
    new PatchedApiCollector(),
    new DevToolsCollector(),
    new EntropySpoofCollector(),
  ];

  // Invasive signals are always opt-in — not included unless explicitly enabled
  if (options.signals?.webrtc) {
    // WebRTCCollector — Phase 1 stretch goal, not yet implemented
  }
  if (options.signals?.battery) {
    // BatteryCollector — Phase 1 stretch goal, not yet implemented
  }

  return collectors;
}

export async function collectAllSignals(
  collectors: BaseCollector[],
): Promise<Record<string, string | number | boolean | null>> {
  const results = await Promise.allSettled(collectors.map((c) => c.safeCollect()));
  return Object.assign(
    {},
    ...results
      .filter((r): r is PromiseFulfilledResult<Record<string, string | number | boolean | null>> =>
        r.status === 'fulfilled',
      )
      .map((r) => r.value),
  );
}
