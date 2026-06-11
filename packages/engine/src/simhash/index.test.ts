import { describe, it, expect } from 'vitest';
import {
  computeSimHash,
  hammingDistance,
  simHashToHex,
  hexToSimHash,
  simHashToInt64,
  int64ToSimHash,
} from './index.js';
import { SIMHASH_CANDIDATE_THRESHOLD } from '../matching/confidence.js';

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

describe('simHashToInt64 / int64ToSimHash', () => {
  // The signed BIGINT packing is what gets stored in identities.latest_signal_hash
  // and pre-filtered in Postgres via bit_count((a # b)::bit(64)). These invariants
  // guarantee the DB pre-filter and the JS Hamming distance agree, and that the
  // migration backfill (('x'||hex)::bit(64)::bigint) lands on the same value.
  it('round-trips through a signed 64-bit integer', () => {
    const h = computeSimHash(BASE_SIGNALS);
    expect(int64ToSimHash(simHashToInt64(h))).toEqual(h);
  });

  it('packs into the signed 64-bit range (may be negative when bit 63 is set)', () => {
    const h = computeSimHash(BASE_SIGNALS);
    const v = simHashToInt64(h);
    expect(v).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(v).toBeLessThanOrEqual(2n ** 63n - 1n);
  });

  it('matches the hex packing: int64 equals the big-endian hi<<32|lo of the hex', () => {
    const h = computeSimHash(BASE_SIGNALS);
    const hex = simHashToHex(h);
    const expected = BigInt.asIntN(64, BigInt('0x' + hex));
    expect(simHashToInt64(h)).toBe(expected);
  });

  it('popcount of the int64 XOR equals the JS Hamming distance', () => {
    const a = computeSimHash(BASE_SIGNALS);
    const b = computeSimHash({ ...BASE_SIGNALS, 'canvas.2d': 'changed', 'screen.width': 1366 });
    const xor = BigInt.asUintN(64, simHashToInt64(a) ^ simHashToInt64(b));
    let popcount = 0;
    for (let bit = 0n; bit < 64n; bit++) if ((xor >> bit) & 1n) popcount++;
    expect(popcount).toBe(hammingDistance(a, b));
  });
});

describe('SimHash candidate pre-filter — edge cases', () => {
  // The candidate pre-filter in routes/events.ts keeps any stored identity whose
  // SimHash is within SIMHASH_CANDIDATE_THRESHOLD Hamming bits of the incoming one.
  // These characterize the distances that gate it.
  const WITH_VOLATILE = { ...BASE_SIGNALS, 'network.type': '4g' };

  it('returns the zero hash for an empty signal map', () => {
    expect(computeSimHash({})).toEqual([0, 0]);
  });

  it('keeps a volatile-only change within the candidate threshold (drift is tolerated)', () => {
    const drifted = { ...WITH_VOLATILE, 'network.type': 'wifi' };
    const dist = hammingDistance(computeSimHash(WITH_VOLATILE), computeSimHash(drifted));
    expect(dist).toBeLessThanOrEqual(SIMHASH_CANDIDATE_THRESHOLD);
  });

  it('a small change is much closer than a fully disjoint signal set', () => {
    const base = computeSimHash(BASE_SIGNALS);
    const small = computeSimHash({ ...BASE_SIGNALS, 'screen.width': 1366 });
    const disjoint = computeSimHash({
      'canvas.2d': 'qqq', 'audio.hash': 'rrr', 'fonts.list': 'Comic Sans',
      'hardware.concurrency': 2, 'screen.width': 320, 'locale.timezone': 'Asia/Tokyo',
    });
    expect(hammingDistance(base, small)).toBeLessThan(hammingDistance(base, disjoint));
  });
});
