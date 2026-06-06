import { describe, it, expect } from 'vitest';
import { diffSnapshots } from './index.js';

const BASE = {
  'canvas.2d': 'abc',
  'audio.hash': '123',
  'fonts.list': 'Arial',
  'screen.width': 1920,
  'locale.timezone': 'Europe/Madrid',
  'network.type': '4g',
};

describe('diffSnapshots', () => {
  it('returns no changes for identical snapshots', () => {
    const result = diffSnapshots(BASE, { ...BASE });
    expect(result.changedSignals).toHaveLength(0);
    expect(result.addedSignals).toHaveLength(0);
    expect(result.removedSignals).toHaveLength(0);
    expect(result.entropy).toBe(0);
    expect(result.classification).toBe('minor');
  });

  it('classifies single volatile signal change as minor', () => {
    const result = diffSnapshots(BASE, { ...BASE, 'network.type': 'wifi' });
    expect(result.changedSignals).toContain('network.type');
    expect(result.classification).toBe('minor');
  });

  it('classifies stable signal change as significant', () => {
    const result = diffSnapshots(BASE, { ...BASE, 'canvas.2d': 'new_hash' });
    expect(result.changedSignals).toContain('canvas.2d');
    expect(result.classification).toBe('significant');
  });

  it('classifies multiple stable changes as suspicious', () => {
    const result = diffSnapshots(BASE, {
      ...BASE,
      'canvas.2d': 'new',
      'audio.hash': 'new',
      'fonts.list': 'Comic Sans',
    });
    expect(result.classification).toBe('suspicious');
    expect(result.entropy).toBeGreaterThan(0);
  });

  it('detects added and removed signals', () => {
    const after = { ...BASE };
    delete (after as Record<string, unknown>)['network.type'];
    const result = diffSnapshots(BASE, { ...after, 'media.dark_mode': true });
    expect(result.removedSignals).toContain('network.type');
    expect(result.addedSignals).toContain('media.dark_mode');
  });

  it('tamper signals are excluded from drift', () => {
    const result = diffSnapshots(BASE, { ...BASE, 'tamper.webdriver': true });
    expect(result.addedSignals).not.toContain('tamper.webdriver');
    expect(result.changedSignals).not.toContain('tamper.webdriver');
  });
});

describe('diffSnapshots — classification edge cases', () => {
  // A signal set rich in moderate-weight signals (screen/locale/platform/plugins),
  // so we can exercise the "moderate" branch without touching stable signals.
  const M = {
    'canvas.2d': 'stable',
    'screen.width': 1920,
    'locale.timezone': 'Europe/Madrid',
    'platform.os': 'Linux',
    'plugins.list': 'pdf',
    'network.type': '4g',
  };

  it('classifies 3+ moderate (non-stable) changes as "moderate"', () => {
    const after = { ...M, 'screen.width': 800, 'locale.timezone': 'Asia/Tokyo', 'platform.os': 'Windows' };
    const r = diffSnapshots(M, after);
    expect(r.changedSignals).toEqual(
      expect.arrayContaining(['screen.width', 'locale.timezone', 'platform.os']),
    );
    expect(r.classification).toBe('moderate');
  });

  it('fewer than 3 moderate changes falls back to "minor"', () => {
    const after = { ...M, 'screen.width': 800, 'locale.timezone': 'Asia/Tokyo' };
    expect(diffSnapshots(M, after).classification).toBe('minor');
  });

  it('a removed stable signal is not a stable *change*: classified "minor" but entropy > 0', () => {
    const after = { ...M };
    delete (after as Record<string, unknown>)['canvas.2d'];
    const r = diffSnapshots(M, after);
    expect(r.removedSignals).toContain('canvas.2d');
    expect(r.changedSignals).not.toContain('canvas.2d');
    expect(r.classification).toBe('minor'); // only `changed` drives the stable-change rule
    expect(r.entropy).toBeGreaterThan(0);    // ...but a removed stable signal still adds entropy
  });

  it('entropy rises with the weighted magnitude of change and is capped at 1', () => {
    const fewModerate = diffSnapshots(M, { ...M, 'screen.width': 800 });
    const manyStable = diffSnapshots(
      { 'canvas.2d': 'a', 'audio.hash': 'b', 'fonts.list': 'c', 'hardware.concurrency': 8 },
      { 'canvas.2d': 'x', 'audio.hash': 'y', 'fonts.list': 'z', 'hardware.concurrency': 1 },
    );
    expect(manyStable.entropy).toBeGreaterThan(fewModerate.entropy);
    expect(manyStable.entropy).toBeLessThanOrEqual(1);
  });
});
