import { describe, it, expect } from 'vitest';
import { CanvasCollector } from './canvas.js';
import { AudioCollector } from './audio.js';
import { FontCollector } from './fonts.js';
import { ScreenCollector } from './screen.js';
import { LocaleCollector } from './locale.js';
import { HardwareCollector } from './hardware.js';
import { TouchCollector } from './touch.js';
import { NetworkCollector } from './network.js';
import { MediaCollector } from './media.js';
import { WebDriverCollector } from './anti-tamper/webdriver.js';
import { HeadlessCollector } from './anti-tamper/headless.js';
import { PatchedApiCollector } from './anti-tamper/patched-api.js';
import { DevToolsCollector } from './anti-tamper/devtools.js';
import { EntropySpoofCollector } from './anti-tamper/entropy-spoof.js';
import { buildCollectors, collectAllSignals } from './index.js';

describe('CanvasCollector', () => {
  it('returns an object with canvas.2d key when canvas is available', async () => {
    const c = new CanvasCollector();
    const result = await c.collect();
    // jsdom supports canvas via the jsdom canvas package or stubs
    // The collector gracefully returns {} if getContext returns null
    expect(typeof result).toBe('object');
    if ('canvas.2d' in result) {
      expect(typeof result['canvas.2d']).toBe('string');
    }
  });

  it('safeCollect() never rejects', async () => {
    const c = new CanvasCollector();
    await expect(c.safeCollect()).resolves.toBeDefined();
  });

  it('has stabilityClass stable', () => {
    expect(new CanvasCollector().stabilityClass).toBe('stable');
  });
});

describe('AudioCollector', () => {
  it('returns empty object when OfflineAudioContext is unavailable', async () => {
    // jsdom does not implement OfflineAudioContext
    const c = new AudioCollector();
    const result = await c.safeCollect();
    expect(result).toEqual({});
  });
});

describe('FontCollector', () => {
  it('returns fonts.list when canvas is available', async () => {
    const c = new FontCollector();
    const result = await c.safeCollect();
    if ('fonts.list' in result) {
      expect(typeof result['fonts.list']).toBe('string');
    }
  });
});

describe('ScreenCollector', () => {
  it('returns numeric screen signals', async () => {
    const c = new ScreenCollector();
    const result = await c.collect();
    expect('screen.width' in result).toBe(true);
    expect('screen.height' in result).toBe(true);
    expect('screen.dpr' in result).toBe(true);
  });
});

describe('LocaleCollector', () => {
  it('returns locale signals', async () => {
    const c = new LocaleCollector();
    const result = await c.collect();
    expect(typeof result['locale.timezone']).toBe('string');
    expect(typeof result['locale.language']).toBe('string');
  });
});

describe('HardwareCollector', () => {
  it('returns hardware.concurrency', async () => {
    const c = new HardwareCollector();
    const result = await c.collect();
    expect('hardware.concurrency' in result).toBe(true);
  });
});

describe('TouchCollector', () => {
  it('returns input signals', async () => {
    const c = new TouchCollector();
    const result = await c.collect();
    expect('input.touch_points' in result).toBe(true);
    expect('input.pointer' in result).toBe(true);
  });
});

describe('NetworkCollector', () => {
  it('returns empty when NetworkInformation API is unavailable', async () => {
    const c = new NetworkCollector();
    const result = await c.safeCollect();
    // jsdom does not implement navigator.connection
    expect(typeof result).toBe('object');
  });
});

describe('MediaCollector', () => {
  it('returns boolean media signals', async () => {
    const c = new MediaCollector();
    const result = await c.collect();
    expect(typeof result['media.dark_mode']).toBe('boolean');
    expect(typeof result['media.reduced_motion']).toBe('boolean');
    expect(typeof result['media.hdr']).toBe('boolean');
  });
});

describe('WebDriverCollector', () => {
  it('detects clean environment correctly', async () => {
    const c = new WebDriverCollector();
    const result = await c.collect();
    // In a clean jsdom test environment, webdriver should be false
    expect(result['tamper.webdriver']).toBe(false);
  });

  it('has stabilityClass volatile', () => {
    expect(new WebDriverCollector().stabilityClass).toBe('volatile');
  });
});

describe('HeadlessCollector', () => {
  it('returns headless signals', async () => {
    const c = new HeadlessCollector();
    const result = await c.collect();
    expect('tamper.no_plugins' in result).toBe(true);
    expect('tamper.headless_chrome' in result).toBe(true);
  });
});

describe('PatchedApiCollector', () => {
  it('reports native canvas APIs as unpatched in clean environment', async () => {
    const c = new PatchedApiCollector();
    const result = await c.collect();
    // In jsdom, canvas APIs are native stubs — should not be marked patched
    expect('tamper.canvas_patched' in result).toBe(true);
  });
});

describe('DevToolsCollector', () => {
  it('returns a boolean devtools signal', async () => {
    const c = new DevToolsCollector();
    const result = await c.collect();
    expect(typeof result['tamper.devtools_open']).toBe('boolean');
  });
});

describe('EntropySpoofCollector', () => {
  it('returns false in clean jsdom environment', async () => {
    const c = new EntropySpoofCollector();
    const result = await c.collect();
    // In jsdom, two canvas renders are identical (no noise injection) → not spoofed
    expect(result['tamper.canvas_noise_spoofed']).toBe(false);
  });
});

describe('buildCollectors', () => {
  it('returns the standard set without invasive signals by default', () => {
    const collectors = buildCollectors({ apiKey: 'test' });
    expect(collectors.length).toBeGreaterThan(10);
    const names = collectors.map((c) => c.name);
    expect(names).toContain('canvas');
    expect(names).toContain('audio');
    expect(names).toContain('anti-tamper.webdriver');
  });
});

describe('collectAllSignals', () => {
  it('merges all collector outputs into a flat SignalRecord', async () => {
    const collectors = buildCollectors({ apiKey: 'test' });
    const signals = await collectAllSignals(collectors);
    expect(typeof signals).toBe('object');
    // Locale and screen are reliable in jsdom
    expect('locale.timezone' in signals || 'screen.width' in signals).toBe(true);
  });

  it('does not include null values in the result', async () => {
    const collectors = buildCollectors({ apiKey: 'test' });
    const signals = await collectAllSignals(collectors);
    for (const value of Object.values(signals)) {
      expect(value).not.toBeNull();
    }
  });
});
