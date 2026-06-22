import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';

// Headers that can carry credentials or session material. Stripped from every event
// even though sendDefaultPii:false already withholds most of this — defense in depth.
const SENSITIVE_HEADERS = ['x-api-key', 'cookie', 'authorization'];

// Removes PII from a Sentry event before it leaves the process. This is an
// identity/fingerprinting product: POST /v1/events request bodies carry raw device
// signals that are PII by definition, and headers/cookies carry credentials. We send
// these to an EU-region Sentry project but still scrub aggressively (ADR-0006) so a
// stack trace never ships a subject's fingerprint or an API key.
//
// Exported and unit-tested: this is the privacy boundary, so it is verified directly
// rather than trusted to integration coverage.
export function scrubPii(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    // Request body (POST /v1/events fingerprint signals) and cookies are always PII here.
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;

    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) {
          delete event.request.headers[name];
        }
      }
    }
  }

  if (event.user) {
    delete event.user.ip_address;
  }

  return event;
}

// Initialises Sentry error tracking. No-ops without SENTRY_DSN (mirrors the
// `${SCENT_SECRET_KEY:-}` "env unset = feature disabled" convention) so dev, test, and
// self-host deployments stay completely inert — every Sentry.* call becomes a no-op
// when init was never run.
//
// Runs at module level so `node --import ./dist/instrument.js` initialises Sentry
// before any app module (Express, pg, bullmq) loads, letting it patch them. The same
// resolved module is reused by the top-of-file import in index.ts/worker.ts, so the
// dev/tsx path initialises early too. Idempotent: a second import is the same module.
if (process.env['SENTRY_DSN']) {
  try {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'],
      release: process.env['SENTRY_RELEASE'],
      // Errors-only by default; raise via env to sample performance traces. Phase 2
      // reconciles this with the app's own OTel setup (ADR-0006).
      tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
      sendDefaultPii: false,
      beforeSend: scrubPii,
    });
  } catch (err) {
    // The one sanctioned console.* in this module: it loads before pino (so the OTel
    // pino instrumentation can patch the logger), and a Sentry init failure must never
    // crash boot. Mirrors tracing.ts's shutdown-path console.error.
    console.error('[instrument] Sentry init failed:', err);
  }
}
