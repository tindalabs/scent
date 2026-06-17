import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

import { init } from '@tindalabs/scent-sdk';
import { ScentOtelBridge, readTraceparent } from '@tindalabs/scent-otel';

// ── OTel setup ───────────────────────────────────────────────────────────────
// OTEL_SERVICE_NAME is read from the environment at build time by the SDK.
const provider = new WebTracerProvider({
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
    ),
  ],
});
provider.register();
const tracer = trace.getTracer('scent-demo');

// ── SDK setup ─────────────────────────────────────────────────────────────────
const sdk = init({
  apiKey: import.meta.env['VITE_API_KEY'] ?? 'demo-api-key-dev',
  endpoint: import.meta.env['VITE_API_BASE'] ?? 'http://localhost:3000/v1',
  persistence: 'balanced',
  traceparentProvider: readTraceparent,
});

const bridge = new ScentOtelBridge(sdk);

const API_BASE = import.meta.env['VITE_API_BASE'] ?? 'http://localhost:3000/v1';
const API_KEY = import.meta.env['VITE_API_KEY'] ?? 'demo-api-key-dev';

interface ServerResult {
  identityId: string | null;
  confidence: number;
  isNew: boolean;
  continuity: string;
  risk: { score: number; band: string; flags: { label: string; reason: string }[] };
}

// POST /v1/resolve — the synchronous "assess this snapshot" check (does not persist).
// Returns null if the server is unreachable or errors, so the caller can fall back to
// the local observation.
async function postResolve(signals: Record<string, unknown>): Promise<ServerResult | null> {
  const tp = readTraceparent(); // W3C trace header so the server span links to this trace
  const response = await fetch(`${API_BASE}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      ...(tp ? { traceparent: tp } : {}),
    },
    body: JSON.stringify({ signals }),
  });
  if (!response.ok) return null;
  const data = await response.json() as {
    identityId: string | null;
    confidence: number;
    isNew: boolean;
    continuity: string;
    risk: { score: number; band: string; flags: { code: string; label: string; reason: string }[] };
  };
  return {
    identityId: data.identityId,
    confidence: data.confidence,
    isNew: data.isNew,
    continuity: data.continuity,
    risk: {
      score: data.risk.score,
      band: data.risk.band,
      // Keep label + reason (reason becomes the chip tooltip). Drop malformed entries
      // so they can't render as "undefined" chips.
      flags: data.risk.flags.filter((f) => Boolean(f.label)).map((f) => ({ label: f.label, reason: f.reason })),
    },
  };
}

// Ingest is asynchronous: sdk.flush() only *enqueues* the snapshot — the worker commits
// it to the identity store a moment later. Poll /v1/resolve until the just-flushed
// observation becomes matchable (isNew flips false), so the next Observe click resolves
// against committed history and recognises the device instead of seeing it as new
// again. Bounded (~4s) so a stopped worker or unreachable server can't hang the UI.
async function waitForCommit(signals: Record<string, unknown>): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 350));
    try {
      const r = await postResolve(signals);
      if (r && !r.isNew) return;
    } catch {
      return; // server unreachable — don't block the UI
    }
  }
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const btnObserve = document.getElementById('btn-observe') as HTMLButtonElement;
const btnClear   = document.getElementById('btn-clear') as HTMLButtonElement;
const consentToggle = document.getElementById('consent-toggle') as HTMLInputElement;
const statusEl   = document.getElementById('status') as HTMLElement;
const resultCard = document.getElementById('result-card') as HTMLElement;
const signalsCard= document.getElementById('signals-card') as HTMLElement;

const idValueEl       = document.getElementById('id-value') as HTMLElement;
const continuityBadge = document.getElementById('continuity-badge') as HTMLElement;
const newBadge        = document.getElementById('new-badge') as HTMLElement;
const confidencePct   = document.getElementById('confidence-pct') as HTMLElement;
const confidenceFill  = document.getElementById('confidence-fill') as HTMLElement;
const riskBadge       = document.getElementById('risk-badge') as HTMLElement;
const riskScore       = document.getElementById('risk-score') as HTMLElement;
const riskFlagsEl     = document.getElementById('risk-flags') as HTMLElement;
const sourceValue     = document.getElementById('source-value') as HTMLElement;
const continuityValue = document.getElementById('continuity-value') as HTMLElement;
const traceparentEl   = document.getElementById('traceparent-value') as HTMLElement;
const signalsTitle    = document.getElementById('signals-title') as HTMLElement;
const signalsGrid     = document.getElementById('signals-grid') as HTMLElement;

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(msg: string, kind: 'idle' | 'loading' | 'success' | 'error' = 'idle') {
  statusEl.textContent = msg;
  statusEl.className = `status-bar ${kind === 'idle' ? '' : kind}`;
}

const CONTINUITY_CLASSES: Record<string, string> = {
  confirmed: 'badge-confirmed',
  probable:  'badge-probable',
  uncertain: 'badge-uncertain',
  unknown:   'badge-unknown',
};

const RISK_CLASSES: Record<string, string> = {
  low:      'badge-low',
  medium:   'badge-medium',
  high:     'badge-high',
  critical: 'badge-critical',
};

function setBadge(el: HTMLElement, text: string, classes: Record<string, string>) {
  el.textContent = text;
  el.className = `badge ${classes[text] ?? 'badge-unknown'}`;
}

function showSignals(signals: Record<string, unknown>) {
  const entries = Object.entries(signals).filter(([, v]) => v !== null && v !== undefined && v !== '');
  signalsTitle.textContent = `Signals collected (${entries.length})`;
  signalsGrid.innerHTML = entries
    .map(([k, v]) => `<div class="signal-item"><span class="signal-key">${k}:</span> ${String(v).slice(0, 40)}</div>`)
    .join('');
  signalsCard.style.display = 'block';
}

// ── Observe flow ──────────────────────────────────────────────────────────────
btnObserve.addEventListener('click', () => {
  btnObserve.disabled = true;
  setStatus('Collecting signals…', 'loading');

  tracer.startActiveSpan('demo.observe', async (span) => {
    try {
      // Step 1: collect signals and resolve locally
      const obs = await bridge.observe();
      const signals = (obs as typeof obs & { _signals?: Record<string, unknown> })._signals ?? {};

      setStatus('Flushing to server…', 'loading');
      showSignals(signals);

      // Step 2: get the server-resolved result, then persist to history.
      //
      // /v1/events is now async (returns 202 with no body), so the inline result comes
      // from POST /v1/resolve — the synchronous "assess this snapshot" endpoint that
      // returns identity + confidence + risk without persisting. We then sdk.flush()
      // (POST /v1/events, fire-and-forget) to commit the observation so it shows up in
      // the Observatory. Resolve-then-flush mirrors the "check, then commit" flow.
      let serverResult: ServerResult | null = null;

      try {
        // Synchronous "check": assess this snapshot against committed history.
        serverResult = await postResolve(signals);
        // Commit the observation to history (async ingest). Populates the Observatory.
        await sdk.flush();
      } catch {
        // Server unreachable — fall back to local result
      }

      const resolved = serverResult ?? {
        identityId: obs.identity.id,
        confidence: obs.identity.confidence,
        isNew: obs.identity.isNew,
        continuity: obs.identity.continuity,
        risk: {
          score: obs.risk.score,
          band: 'low',
          flags: (obs.risk.flags ?? []).map((f) => ({ label: String(f), reason: String(f) })),
        },
      };

      const source = serverResult ? 'server (probabilistic engine)' : 'local (Phase 1 fallback)';
      const tp = readTraceparent();

      // Update UI. Null-coalesce every numeric/array field — the local fallback
      // observation may carry nulls (Phase-1 placeholders), and we never want a
      // render crash to mask the actual result.
      const confidence = resolved.confidence ?? 0;
      const riskScoreVal = resolved.risk.score ?? 0;
      const flags = resolved.risk.flags ?? [];

      // /resolve returns a null id for a brand-new visitor (it doesn't persist), so
      // fall back to the SDK's local identity id for display.
      idValueEl.textContent = resolved.identityId ?? obs.identity.id;
      confidenceFill.style.width = `${Math.round(confidence * 100)}%`;
      confidencePct.textContent = `${Math.round(confidence * 100)}%`;

      setBadge(continuityBadge, resolved.continuity, CONTINUITY_CLASSES);
      continuityValue.textContent = resolved.continuity;

      newBadge.style.display = resolved.isNew ? 'inline' : 'none';

      setBadge(riskBadge, resolved.risk.band, RISK_CLASSES);
      riskScore.textContent = `(score: ${riskScoreVal.toFixed(3)})`;

      // Each flag chip shows its label; hovering reveals the reason (native tooltip).
      riskFlagsEl.innerHTML = flags.length
        ? flags
            .map((f) => `<span class="flag" title="${f.reason.replace(/"/g, '&quot;')}">${f.label}</span>`)
            .join('')
        : '';

      sourceValue.textContent = source;
      traceparentEl.textContent = tp ? tp.slice(0, 55) + '…' : 'none (OTel span inactive)';

      resultCard.style.display = 'block';
      if (!resolved.isNew) {
        setStatus(`Returning identity — confidence ${Math.round(resolved.confidence * 100)}%.`, 'success');
      } else if (serverResult) {
        // A genuine first sight. Ingest is async (flush only enqueued), so wait out the
        // commit before re-enabling Observe — otherwise a quick second click resolves
        // before the worker persists this one and the device looks "new" again.
        setStatus('New identity created — committing to history…', 'loading');
        await waitForCommit(signals);
        setStatus('New identity committed — click Observe again to see it recognised.', 'success');
      } else {
        setStatus('New identity created (local fallback — server unreachable).', 'success');
      }
    } catch (err) {
      setStatus(String(err instanceof Error ? err.message : err), 'error');
    } finally {
      span.end();
      btnObserve.disabled = false;
    }
  });
});

// ── Consent gate ──────────────────────────────────────────────────────────────
// Privacy-by-default (ADR-0004): observe() is a no-op until consent is granted. This
// checkbox stands in for the host application's CMP — in production you wire
// init({ consent: { mode: 'tcf' | 'gcm' | 'callback' } }) instead of calling setConsent().
function applyConsent() {
  sdk.setConsent(consentToggle.checked);
  btnObserve.disabled = !consentToggle.checked;
  setStatus(
    consentToggle.checked
      ? 'Consent granted — click Observe to start.'
      : 'Consent required — collection is off until you opt in.',
    consentToggle.checked ? 'success' : 'idle',
  );
}
consentToggle.addEventListener('change', applyConsent);
applyConsent(); // start closed (checkbox defaults unchecked → Observe disabled)

// ── Forget me ─────────────────────────────────────────────────────────────────
// Right to be forgotten: forget() purges every local storage layer and returns the
// cleared identity id so a host could also call DELETE /v1/identity/:id server-side.
btnClear.addEventListener('click', async () => {
  try {
    const cleared = await sdk.forget();
    setStatus(
      cleared
        ? `Forgotten (${cleared.slice(0, 8)}…) — next observe creates a new identity.`
        : 'Nothing to forget — no local identity was stored.',
      'success',
    );
    resultCard.style.display = 'none';
    signalsCard.style.display = 'none';
  } catch {
    setStatus('Could not clear all storage.', 'error');
  }
});
