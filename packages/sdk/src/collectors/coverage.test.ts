import { describe, it, expect } from 'vitest';
import { BaseCollector } from './base.js';
import { PlatformCollector } from './platform.js';
import { PluginCollector } from './plugins.js';
import { StorageModeCollector } from './storage-mode.js';
import { WebRTCCollector } from './webrtc.js';
import { buildCollectors, collectAllSignals } from './index.js';
import type { SignalRecord } from './types.js';

describe('BaseCollector.safeCollect', () => {
  class Throwing extends BaseCollector {
    readonly name = 'throwing';
    readonly stabilityClass = 'volatile' as const;
    collect(): Promise<SignalRecord> {
      throw new Error('collector blew up');
    }
  }

  it('swallows collector errors and returns an empty record (never rejects)', async () => {
    await expect(new Throwing().safeCollect()).resolves.toEqual({});
  });
});

describe('PlatformCollector', () => {
  it('returns string platform signals', async () => {
    const result = await new PlatformCollector().collect();
    expect('platform.os' in result).toBe(true);
    expect(typeof result['platform.os']).toBe('string');
  });

  it('never stores the raw User-Agent string (privacy: UA is coarse-grained only)', async () => {
    const result = await new PlatformCollector().collect();
    for (const value of Object.values(result)) {
      expect(value).not.toBe(navigator.userAgent);
    }
  });
});

describe('PluginCollector', () => {
  it('returns an object; plugins.list, when present, is a comma-joined string', async () => {
    const result = await new PluginCollector().collect();
    expect(typeof result).toBe('object');
    if ('plugins.list' in result) {
      expect(typeof result['plugins.list']).toBe('string');
    }
  });
});

describe('StorageModeCollector', () => {
  it('reports storage as unrestricted in a normal (non-private) jsdom env', async () => {
    const result = await new StorageModeCollector().collect();
    expect(result['storage.restricted']).toBe(false);
  });
});

describe('WebRTCCollector', () => {
  it('returns an empty record when RTCPeerConnection is unavailable (jsdom)', async () => {
    // jsdom does not implement RTCPeerConnection
    expect(await new WebRTCCollector().collect()).toEqual({});
  });
});

describe('buildCollectors — invasive signals are opt-in', () => {
  const names = (opts: Parameters<typeof buildCollectors>[0]) =>
    buildCollectors(opts).map((c) => c.name);

  it('excludes WebRTC by default', () => {
    expect(names({ apiKey: 'test' })).not.toContain('webrtc');
  });

  it('includes WebRTC only when explicitly enabled', () => {
    expect(names({ apiKey: 'test', signals: { webrtc: true } })).toContain('webrtc');
  });
});

describe('collectAllSignals — privacy invariants over the default set', () => {
  it('emits no WebRTC / IP signals by default', async () => {
    const signals = await collectAllSignals(buildCollectors({ apiKey: 'test' }));
    expect(Object.keys(signals).some((k) => k.startsWith('webrtc.'))).toBe(false);
  });

  it('emits no value equal to the raw User-Agent and nothing resembling an email', async () => {
    const signals = await collectAllSignals(buildCollectors({ apiKey: 'test' }));
    for (const value of Object.values(signals)) {
      expect(value).not.toBe(navigator.userAgent);
      if (typeof value === 'string') {
        expect(value).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/); // no email-shaped PII
      }
    }
  });

  it('every emitted value is a primitive signal (string | number | boolean), never an object', async () => {
    const signals = await collectAllSignals(buildCollectors({ apiKey: 'test' }));
    for (const value of Object.values(signals)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });
});
