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

// ── DOM refs ─────────────────────────────────────────────────────────────────
const btnObserve = document.getElementById('btn-observe') as HTMLButtonElement;
const btnClear   = document.getElementById('btn-clear') as HTMLButtonElement;
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

      // Step 2: flush to server and get server-resolved result
      let serverResult: {
        identityId: string;
        confidence: number;
        isNew: boolean;
        continuity: string;
        risk: { score: number; band: string; flags: string[] };
        ambiguous?: boolean;
      } | null = null;

      try {
        // Flush returns void; we re-fetch with a manual call to capture the response.
        const tp = readTraceparent();
        const response = await fetch(
          `${import.meta.env['VITE_API_BASE'] ?? 'http://localhost:3000/v1'}/events`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Key': import.meta.env['VITE_API_KEY'] ?? 'demo-api-key-dev',
            },
            body: JSON.stringify({
              snapshots: [{
                identityId: obs.identity.id,
                signals,
                persistencePolicy: 'balanced',
                timestamp: new Date().toISOString(),
                ...(tp ? { traceparent: tp } : {}),
              }],
            }),
          },
        );

        if (response.ok) {
          const data = await response.json() as { results: typeof serverResult[] };
          serverResult = data.results[0] ?? null;
        }
      } catch {
        // Server unreachable — fall back to local result
      }

      const resolved = serverResult ?? {
        identityId: obs.identity.id,
        confidence: obs.identity.confidence,
        isNew: obs.identity.isNew,
        continuity: obs.identity.continuity,
        risk: { score: obs.risk.score, band: 'low', flags: obs.risk.flags },
      };

      const source = serverResult ? 'server (probabilistic engine)' : 'local (Phase 1 fallback)';
      const tp = readTraceparent();

      // Update UI
      idValueEl.textContent = resolved.identityId;
      confidenceFill.style.width = `${Math.round(resolved.confidence * 100)}%`;
      confidencePct.textContent = `${Math.round(resolved.confidence * 100)}%`;

      setBadge(continuityBadge, resolved.continuity, CONTINUITY_CLASSES);
      continuityValue.textContent = resolved.continuity;

      newBadge.style.display = resolved.isNew ? 'inline' : 'none';

      setBadge(riskBadge, resolved.risk.band, RISK_CLASSES);
      riskScore.textContent = `(score: ${resolved.risk.score.toFixed(3)})`;

      riskFlagsEl.innerHTML = resolved.risk.flags.length
        ? resolved.risk.flags.map((f: string) => `<span class="flag">${f}</span>`).join('')
        : '';

      sourceValue.textContent = source;
      traceparentEl.textContent = tp ? tp.slice(0, 55) + '…' : 'none (OTel span inactive)';

      resultCard.style.display = 'block';
      setStatus(
        resolved.isNew
          ? 'New identity created.'
          : `Returning identity — confidence ${Math.round(resolved.confidence * 100)}%.`,
        'success',
      );
    } catch (err) {
      setStatus(String(err instanceof Error ? err.message : err), 'error');
    } finally {
      span.end();
      btnObserve.disabled = false;
    }
  });
});

// ── Clear storage ─────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  try {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(';').forEach((c) => {
      document.cookie = c.replace(/=.*/, '=;expires=' + new Date(0).toUTCString() + ';path=/');
    });
    setStatus('Storage cleared — next observe will create a new identity.', 'success');
    resultCard.style.display = 'none';
    signalsCard.style.display = 'none';
  } catch {
    setStatus('Could not clear all storage.', 'error');
  }
});
