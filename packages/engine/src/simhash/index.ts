import type { SignalMap } from '../types.js';
import { weightOf } from '../signals/weights.js';

// 64-bit SimHash represented as a pair of 32-bit unsigned integers [hi, lo].
// JavaScript lacks native 64-bit integers so we split into two 32-bit halves.
export type SimHash = readonly [hi: number, lo: number];

// FNV-1a 32-bit hash of a string token. Fast and well-distributed for short strings.
function fnv32a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

// Expand one 32-bit hash into a pair by mixing with a different prime.
function expandTo64(h32: number): SimHash {
  const hi = h32;
  const lo = ((h32 * 0x9e3779b9) ^ (h32 >>> 16)) >>> 0;
  return [hi, lo] as const;
}

// Produce a 64-bit SimHash for the given signal map.
// Volatile signals (tamper.*) and null values are excluded — they contribute
// too much noise to the stable-signal fingerprint used for candidate retrieval.
export function computeSimHash(signals: SignalMap): SimHash {
  // Two 64-element accumulator arrays (32-bit per element).
  const v = new Int32Array(64);

  for (const [key, value] of Object.entries(signals)) {
    if (value === null) continue;
    if (key.startsWith('tamper.')) continue;

    const weight = weightOf(key);
    // Quantize weight into integer units so low-weight signals contribute less.
    const units = Math.round(weight * 10);
    const token = `${key}:${String(value)}`;
    const h32 = fnv32a(token);
    const [hi, lo] = expandTo64(h32);

    for (let bit = 0; bit < 32; bit++) {
      v[bit] = (v[bit] ?? 0) + (((hi >>> bit) & 1) ? units : -units);
      v[bit + 32] = (v[bit + 32] ?? 0) + (((lo >>> bit) & 1) ? units : -units);
    }
  }

  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if ((v[bit] ?? 0) > 0) hi |= 1 << bit;
    if ((v[bit + 32] ?? 0) > 0) lo |= 1 << bit;
  }

  return [hi >>> 0, lo >>> 0] as const;
}

// Hamming distance between two SimHashes (number of differing bits, 0–64).
export function hammingDistance(a: SimHash, b: SimHash): number {
  const xorHi = (a[0] ^ b[0]) >>> 0;
  const xorLo = (a[1] ^ b[1]) >>> 0;
  return popcount32(xorHi) + popcount32(xorLo);
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// Serialise a SimHash to a hex string for storage in PostgreSQL.
export function simHashToHex(h: SimHash): string {
  return h[0].toString(16).padStart(8, '0') + h[1].toString(16).padStart(8, '0');
}

// Parse a hex string back to a SimHash.
export function hexToSimHash(hex: string): SimHash {
  const hi = parseInt(hex.slice(0, 8), 16);
  const lo = parseInt(hex.slice(8, 16), 16);
  return [hi >>> 0, lo >>> 0] as const;
}
