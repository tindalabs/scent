import { describe, it, expect } from 'vitest';
import { computeSimHash, hammingDistance, simHashToHex, hexToSimHash } from './index.js';

const BASE_SIGNALS = {
  'canvas.2d': 'abc123',
  'canvas.webgl': 'NVIDIA GeForce RTX 3080',
  'audio.hash': '1234567',
  'fonts.list': 'Arial,Helvetica,Times New Roman',
  'hardware.concurrency': 8,
  'screen.width': 1920,
  'screen.height': 1080,
  'locale.timezone': 'Europe/Madrid',
};

describe('computeSimHash', () => {
  it('produces a stable hash for the same inputs', () => {
    const h1 = computeSimHash(BASE_SIGNALS);
    const h2 = computeSimHash({ ...BASE_SIGNALS });
    expect(h1).toEqual(h2);
  });

  it('produces different hashes for meaningfully different signal sets', () => {
    const h1 = computeSimHash(BASE_SIGNALS);
    const h2 = computeSimHash({ ...BASE_SIGNALS, 'canvas.2d': 'completely_different_hash' });
    const dist = hammingDistance(h1, h2);
    expect(dist).toBeGreaterThan(0);
  });

  it('null values are excluded and do not affect the hash', () => {
    const h1 = computeSimHash(BASE_SIGNALS);
    const h2 = computeSimHash({ ...BASE_SIGNALS, 'screen.color_depth': null });
    // Null signals are skipped so adding them should produce the same hash.
    expect(h1).toEqual(h2);
  });

  it('tamper signals are excluded from the hash', () => {
    const h1 = computeSimHash(BASE_SIGNALS);
    const h2 = computeSimHash({ ...BASE_SIGNALS, 'tamper.webdriver': true });
    expect(h1).toEqual(h2);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    const h = computeSimHash(BASE_SIGNALS);
    expect(hammingDistance(h, h)).toBe(0);
  });

  it('returns a value between 0 and 64', () => {
    const h1 = computeSimHash(BASE_SIGNALS);
    const h2 = computeSimHash({ 'canvas.2d': 'totally_different', 'screen.width': 800 });
    const d = hammingDistance(h1, h2);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(64);
  });
});

describe('simHashToHex / hexToSimHash', () => {
  it('round-trips correctly', () => {
    const h = computeSimHash(BASE_SIGNALS);
    const hex = simHashToHex(h);
    expect(hex).toHaveLength(16);
    expect(hexToSimHash(hex)).toEqual(h);
  });
});
