import type { SignalMap } from '../types.js';
import type { RiskFlag } from '../types.js';

// Maps each anti-tamper signal to a confidence contribution.
// Signals are weighted by how reliably they indicate real automation vs.
// false positives (e.g. devtools_open has many false positives in dev environments).
const TAMPER_WEIGHTS: Record<string, number> = {
  'tamper.webdriver': 0.90,      // navigator.webdriver is very reliable
  'tamper.cdp': 0.85,            // CDP artifacts are strong automation indicators
  'tamper.playwright': 0.85,     // playwright-specific artifacts
  'tamper.headless_chrome': 0.70,
  'tamper.no_plugins': 0.50,     // headless heuristic — also common in some real browsers
  'tamper.screen_inconsistent': 0.65,
  'tamper.canvas_patched': 0.75, // evasion attempt as well as automation
  'tamper.get_context_patched': 0.70,
  'tamper.webgl_patched': 0.70,
  'tamper.canvas_noise_spoofed': 0.80, // deliberate entropy injection
  'tamper.devtools_open': 0.20,  // very low — common in dev environments
};

// Above this combined confidence we call it automation; below it the signals are weak
// (e.g. devtools open in a dev environment) and we use softer wording so a human with
// devtools open isn't labelled a bot. The machine-readable `code` stays stable either way.
const AUTOMATION_CONFIDENCE = 0.5;

// Combines all SDK-side anti-tamper signals into a single automation risk flag.
// Uses a probabilistic OR: P(automation) = 1 − ∏(1 − w_i) for all active signals.
export function detectAutomation(signals: SignalMap): RiskFlag | null {
  const activeWeights: number[] = [];
  const activeSignals: string[] = [];

  for (const [key, weight] of Object.entries(TAMPER_WEIGHTS)) {
    if (signals[key] === true) {
      activeWeights.push(weight);
      activeSignals.push(key);
    }
  }

  if (activeWeights.length === 0) return null;

  const confidence = 1 - activeWeights.reduce((prod, w) => prod * (1 - w), 1);
  // Drop the `tamper.` prefix — the reason is surfaced to humans in the UI.
  const names = activeSignals.map((s) => s.replace(/^tamper\./, '')).join(', ');

  return {
    code: 'automation_suspected',
    label: confidence >= AUTOMATION_CONFIDENCE ? 'Automation detected' : 'Anti-tamper signals',
    reason: `Anti-tamper signals active: ${names}`,
    confidence: Math.min(0.99, confidence),
  };
}
