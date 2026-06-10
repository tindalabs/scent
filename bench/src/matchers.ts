import { weightedJaccard, scoreToIdentityContinuity } from '@tindalabs/scent-engine';
import type { SignalMap } from './signals.js';

// A matcher scores how strongly two snapshots look like the same entity.
// Deterministic libraries are binary: 1 (identical hash) or 0. Scent returns a
// calibrated [0,1] confidence. The headline "linked" decision applies the
// appropriate rule per matcher (see linked()).
export interface Matcher {
  name: string;
  blurb: string;
  deterministic: boolean;
  score: (before: SignalMap, after: SignalMap) => number;
}

// Scent links at continuity ≥ "probable" (score ≥ 0.60); "confirmed" is ≥ 0.85.
export const PROBABLE_THRESHOLD = 0.6;
export const CONFIRMED_THRESHOLD = 0.85;

export function linked(m: Matcher, score: number): boolean {
  return m.deterministic ? score === 1 : score >= PROBABLE_THRESHOLD;
}

// ── Deterministic fingerprint libraries ────────────────────────────────────
// FingerprintJS (OSS) and ThumbmarkJS compute a hash over a fixed component set
// → a visitorId; two visits are "the same" iff that hash is byte-for-byte
// identical. We model that faithfully by comparing the serialized signal subset
// each library hashes — holding signal *collection* constant so the only
// variable is the matching strategy. Any change to a single hashed component
// yields a new ID, which is the documented behaviour of deterministic hashing.

function deterministicId(signals: SignalMap, components: readonly string[]): string {
  return components.map((k) => `${k}=${String(signals[k] ?? '')}`).join('|');
}

const FPJS_COMPONENTS = [
  'canvas.2d', 'canvas.webgl', 'audio.hash', 'fonts.list',
  'hardware.concurrency', 'hardware.memory',
  'screen.width', 'screen.height', 'screen.color_depth',
  'locale.timezone', 'locale.language',
  'platform.os', 'platform.os_version', 'plugins.list',
] as const;

// ThumbmarkJS deliberately drops the most volatile components (screen geometry,
// OS minor version, plugins, webgl) to be more stable — but it is still a
// deterministic hash, so canvas/audio/font changes still mint a new ID.
const THUMBMARK_COMPONENTS = [
  'canvas.2d', 'audio.hash', 'fonts.list',
  'hardware.concurrency', 'hardware.memory',
  'locale.timezone', 'locale.language', 'platform.os',
] as const;

function deterministicMatcher(name: string, blurb: string, components: readonly string[]): Matcher {
  return {
    name,
    blurb,
    deterministic: true,
    score: (before, after) =>
      deterministicId(before, components) === deterministicId(after, components) ? 1 : 0,
  };
}

// ── Scent ───────────────────────────────────────────────────────────────────
// The real production engine: weighted Jaccard similarity → calibrated
// continuity. toleratedMismatches: 1 is the engine default.
const scentMatcher: Matcher = {
  name: 'Scent',
  blurb: 'Probabilistic weighted-Jaccard (real @tindalabs/scent-engine)',
  deterministic: false,
  score: (before, after) => weightedJaccard(before, after, { toleratedMismatches: 1 }).confidence,
};

export function continuityOf(score: number): string {
  return scoreToIdentityContinuity(score);
}

export const MATCHERS: Matcher[] = [
  deterministicMatcher(
    'FingerprintJS (OSS)',
    'Deterministic hash over canvas/webgl/audio/fonts/screen/platform/timezone',
    FPJS_COMPONENTS,
  ),
  deterministicMatcher(
    'ThumbmarkJS',
    'Deterministic hash over a stability-tuned subset (drops screen/webgl/plugins)',
    THUMBMARK_COMPONENTS,
  ),
  scentMatcher,
];
