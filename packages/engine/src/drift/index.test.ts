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
