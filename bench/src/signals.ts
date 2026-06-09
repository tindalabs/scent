import type { Rng } from './rng.js';
import { pick, pickOther, randHex, subset } from './rng.js';

// A signal map mirrors @tindalabs/scent-engine's SignalMap and uses the real
// signal keys from docs/signals.md, so the engine's prefix-based weighting
// (canvas./audio./fonts./hardware. = stable 0.9; screen./locale./platform./
// plugins./media./input. = moderate 0.55; network. = volatile 0.15) applies
// exactly as it does in production.
export type SignalMap = Record<string, string | number | boolean | null>;

// ── Categorical value domains (low cardinality → realistic cross-entity
//    collisions on these signals, which is what makes false-merge non-trivial).
const GPUS = [
  'ANGLE (Intel, Mesa Intel UHD 620)',
  'ANGLE (NVIDIA GeForce RTX 3060)',
  'ANGLE (AMD Radeon RX 6700 XT)',
  'Apple GPU',
  'ANGLE (Intel Iris Xe)',
  'Mali-G78',
] as const;
const FONTS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia',
  'Segoe UI', 'Roboto', 'Calibri', 'Cambria', 'Consolas', 'SF Pro', 'Ubuntu',
] as const;
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London',
  'Europe/Madrid', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney',
] as const;
const LANGS = ['en-US', 'en-GB', 'es-ES', 'de-DE', 'fr-FR', 'ja-JP', 'pt-BR'] as const;
const RESOLUTIONS = [
  [1920, 1080], [2560, 1440], [1366, 768], [3840, 2160], [1440, 900], [1536, 864],
] as const;
const DPRS = [1, 1.25, 1.5, 2, 3] as const;
const CONCURRENCY = [4, 8, 12, 16] as const;
const MEMORY = [4, 8, 16, 32] as const;
const OSES = ['Windows', 'macOS', 'Linux', 'Android', 'iOS'] as const;
const OS_VERSIONS = ['10.0', '11.0', '13.4', '14.1', '15.0'] as const;
const NET_TYPES = ['wifi', '4g', '5g', 'ethernet'] as const;

// Not every browser exposes every signal — modelling this gives each entity a
// slightly different signal set, so matching scores vary entity-to-entity
// instead of being constant per scenario.
const PRESENCE: Record<string, number> = {
  'audio.hash': 0.85,
  'canvas.webgl': 0.92,
  'plugins.list': 0.7,
  'network.downlink': 0.6,
  'media.dark_mode': 0.9,
};

function serializeFonts(list: readonly string[]): string {
  return [...list].sort().join(',');
}

function otherResolution(rng: Rng, w: number, h: number): readonly [number, number] {
  let r = pick(rng, RESOLUTIONS);
  while (r[0] === w && r[1] === h) r = pick(rng, RESOLUTIONS);
  return r;
}

// Generate one base profile for a distinct synthetic entity.
export function makeEntity(rng: Rng): SignalMap {
  const [w, h] = pick(rng, RESOLUTIONS);
  const fonts = subset(rng, FONTS, 0.6);
  const s: SignalMap = {
    // Highly stable (0.9)
    'canvas.2d': randHex(rng, 16),
    'canvas.webgl': pick(rng, GPUS),
    'audio.hash': randHex(rng, 12),
    'fonts.list': serializeFonts(fonts.length ? fonts : ['Arial']),
    'hardware.concurrency': pick(rng, CONCURRENCY),
    'hardware.memory': pick(rng, MEMORY),
    // Moderately stable (0.55)
    'screen.width': w,
    'screen.height': h,
    'screen.color_depth': pick(rng, [24, 30]),
    'screen.dpr': pick(rng, DPRS),
    'locale.timezone': pick(rng, TIMEZONES),
    'locale.language': pick(rng, LANGS),
    'platform.os': pick(rng, OSES),
    'platform.os_version': pick(rng, OS_VERSIONS),
    'plugins.list': randHex(rng, 6),
    'media.dark_mode': rng() < 0.5,
    // Volatile (0.15)
    'network.type': pick(rng, NET_TYPES),
    'network.downlink': Math.round(rng() * 100) / 10,
  };
  // Drop optional signals this entity does not expose.
  for (const [k, p] of Object.entries(PRESENCE)) if (rng() >= p) delete s[k];
  return s;
}

// Mutate a signal only if the entity has it, and only with the given
// probability — this makes each scenario change a *variable* number of signals
// per entity, so recall is a distribution rather than a step function.
function mut(
  snap: SignalMap,
  key: string,
  prob: number,
  rng: Rng,
  next: (current: SignalMap[string]) => SignalMap[string],
): void {
  if (snap[key] === undefined) return;
  if (rng() < prob) snap[key] = next(snap[key]);
}

// ── Drift scenarios: each takes a base profile and returns the SAME entity's
//    "return visit" snapshot after a realistic change. `weight` is the relative
//    prevalence used for the prevalence-weighted overall recall.
export interface Scenario {
  key: string;
  label: string;
  weight: number;
  apply: (base: SignalMap, rng: Rng) => SignalMap;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'same_session',
    label: 'Same session (no change)',
    weight: 0.25,
    apply: (b) => ({ ...b }),
  },
  {
    key: 'minor',
    label: 'Minor drift (network only)',
    weight: 0.2,
    apply: (b, rng) => {
      const s = { ...b };
      mut(s, 'network.type', 1, rng, (c) => pickOther(rng, NET_TYPES, c as string));
      mut(s, 'network.downlink', 1, rng, () => Math.round(rng() * 100) / 10);
      mut(s, 'screen.dpr', 0.3, rng, (c) => pickOther(rng, DPRS, c as number));
      return s;
    },
  },
  {
    key: 'browser_update',
    label: 'Browser update (canvas/webgl/audio regenerate)',
    weight: 0.2,
    apply: (b, rng) => {
      const s = { ...b };
      mut(s, 'canvas.2d', 1, rng, () => randHex(rng, 16));
      mut(s, 'audio.hash', 0.7, rng, () => randHex(rng, 12));
      mut(s, 'canvas.webgl', 0.6, rng, () => randHex(rng, 12)); // driver bump perturbs the renderer hash
      mut(s, 'platform.os_version', 0.5, rng, (c) => pickOther(rng, OS_VERSIONS, c as string));
      return s;
    },
  },
  {
    key: 'vpn_change',
    label: 'VPN / travel (timezone + network change)',
    weight: 0.15,
    apply: (b, rng) => {
      const s = { ...b };
      mut(s, 'locale.timezone', 1, rng, (c) => pickOther(rng, TIMEZONES, c as string));
      mut(s, 'network.type', 1, rng, (c) => pickOther(rng, NET_TYPES, c as string));
      mut(s, 'network.downlink', 1, rng, () => Math.round(rng() * 100) / 10);
      mut(s, 'locale.language', 0.2, rng, (c) => pickOther(rng, LANGS, c as string));
      return s;
    },
  },
  {
    key: 'new_monitor',
    label: 'New monitor (screen geometry change)',
    weight: 0.1,
    apply: (b, rng) => {
      const s = { ...b };
      const [w, h] = otherResolution(rng, b['screen.width'] as number, b['screen.height'] as number);
      s['screen.width'] = w;
      s['screen.height'] = h;
      mut(s, 'screen.dpr', 0.7, rng, (c) => pickOther(rng, DPRS, c as number));
      mut(s, 'screen.color_depth', 0.15, rng, (c) => (c === 24 ? 30 : 24));
      return s;
    },
  },
  {
    key: 'anti_fingerprint',
    label: 'Anti-fingerprinting (per-load canvas/audio randomization)',
    weight: 0.1,
    apply: (b, rng) => {
      const s = { ...b };
      // Brave/Firefox RFP return fresh randomized values on every load.
      mut(s, 'canvas.2d', 1, rng, () => randHex(rng, 16));
      mut(s, 'canvas.webgl', 1, rng, () => randHex(rng, 12));
      mut(s, 'audio.hash', 0.85, rng, () => randHex(rng, 12));
      // Font enumeration is also perturbed: drop the first font.
      mut(s, 'fonts.list', 0.6, rng, (c) => serializeFonts((c as string).split(',').slice(1)));
      return s;
    },
  },
];
