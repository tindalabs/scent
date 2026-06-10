// Deterministic, seedable PRNG so every benchmark run is byte-for-byte
// reproducible (no Math.random — results must be auditable and re-runnable).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// A different element than `current` (for modelling a signal that changes).
export function pickOther<T>(rng: Rng, arr: readonly T[], current: T): T {
  if (arr.length <= 1) return current;
  let next = current;
  while (next === current) next = pick(rng, arr);
  return next;
}

// Random lowercase-hex string — models a high-entropy hash (canvas / audio).
export function randHex(rng: Rng, length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

// A stable subset of `arr` (each element included with probability `p`).
export function subset<T>(rng: Rng, arr: readonly T[], p: number): T[] {
  return arr.filter(() => rng() < p);
}
