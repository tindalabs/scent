# ADR-0006: Sentry-led error tracking now; OTel traces/logs to a backend deferred

**Status:** Accepted
**Date:** 2026-06-21

## Context

The hosted box (`api.scent.tindalabs.dev`) was **instrumented but blind**. The server is
fully wired for OpenTelemetry ([tracing.ts](../../packages/server/src/tracing.ts): NodeSDK +
auto-instrumentations + OTLP exporter) and emits `pino` logs with `trace_id`/`span_id`
correlation — but prod sets `OTEL_SDK_DISABLED=true` on both services
([deploy/docker-compose.yml](../../deploy/docker-compose.yml)), so every trace is dropped and
logs go only to `docker logs` (ephemeral, no search, no alerting). There was **no error
tracking, no alerting, no uptime monitoring**: if prod threw or the box went down, nothing
told us. With live design-partner traffic on the box, that is the gap to close first.

The OTel wiring is disabled rather than removed deliberately: standing up a managed OTLP
backend (Grafana Cloud / Honeycomb / Dash0), reconciling sampling/cost, and shipping logs
off-box is a larger project than "tell me the moment prod breaks, with a stack trace."

## Decision

**Sentry-led.** Add error tracking + alerting via `@sentry/node` now; defer turning on the
existing OTel traces/logs to a managed backend to an explicit **phase 2**.

Sentry is the fastest path to actionable production errors for a small team: SDK + DSN +
alert rule, stack traces with request/job context, issue grouping and regression detection,
deploy-aware via release tags. Because this is a PII-sensitive fingerprinting product in the
EU under BSL, the posture is **Sentry EU region + strict PII scrubbing**.

### Phase 1 (this ADR — built)

- **`@sentry/node` v10** (the current major; sets up its own OpenTelemetry under the hood —
  see coexistence note below). Added to the server package.
- **[instrument.ts](../../packages/server/src/instrument.ts)** runs `Sentry.init` at module
  level and **no-ops without `SENTRY_DSN`** — mirroring the `${SCENT_SECRET_KEY:-}`
  "env unset = feature disabled" convention, so dev, test, and self-host stay completely
  inert (every `Sentry.*` call becomes a no-op when init never ran).
- **PII scrubbing**: `sendDefaultPii: false` plus an exported, unit-tested `beforeSend`
  (`scrubPii`) that strips the request body (POST `/v1/events` bodies carry raw fingerprint
  signals = PII), cookies, the `x-api-key`/`cookie`/`authorization` headers, the query
  string, and the client IP. Defense in depth: the explicit strip holds even if a future SDK
  default changes.
- **Capture surface**: `Sentry.setupExpressErrorHandler(app)` after all routes
  ([app.ts](../../packages/server/src/app.ts)) for sync throws / `next(err)`; the default
  global handlers for unhandled rejections; explicit `Sentry.captureException` in the
  worker's BullMQ `failed` handlers (BullMQ swallows the throw into the event, so the global
  handlers never see it) plus `Sentry.flush(2000)` in worker `shutdown()`.
- **Preload**: `--import ./dist/instrument.js` before `./dist/tracing.js` in the server
  Dockerfile `CMD`, the worker compose `command`, and `worker:start`, so Sentry patches
  before app modules load. The dev/`tsx` path gets it via a top-of-file import in
  index.ts/worker.ts.
- **Errors-only by default**: `tracesSampleRate` defaults to 0 (env-overridable).
- **Uptime**: an external monitor on `/health` (Better Stack / UptimeRobot) catches a
  hard-down box Sentry can't — an ops step (runbook), not code.

The DSN is a write-only ingest key (not a cloud/API token of the class the operator avoids),
so it is fine to keep in `.env`.

### Phase 2 (deferred — NOT built here)

Turn on the existing OTel traces/logs to a managed **EU** OTLP backend: set
`OTEL_EXPORTER_OTLP_ENDPOINT`, flip `OTEL_SDK_DISABLED=false`, ship `pino` logs off-box.
Optional source-map upload for readable minified stack traces — needs a `SENTRY_AUTH_TOKEN`
(a token-class CI secret), so it stays gated/deferred. Optional `@sentry/profiling-node`.

## Key technical nuance: Sentry vs. the app's OTel

Sentry Node v8+/v10 stands up its **own** OpenTelemetry instance. In phase 1 there is **no
conflict** because the two are mutually exclusive by config: the app's OTel is off in prod
(where Sentry runs), and Sentry is off everywhere the app's OTel is on (dev/self-host with a
local collector). Phase 2 must reconcile them — either `skipOpenTelemetrySetup: true` on the
Sentry init and register Sentry's span processor on the app's `NodeSDK`, or let Sentry own
OTel and export onward. Documented here so the phase-2 implementer doesn't double-initialise.

## Consequences

- Prod errors are now visible with stack traces and context, with alerting — the core
  operational blind spot is closed.
- Privacy posture is explicit and auditable (EU residency + scrubbing), consistent with
  [ADR-0004](0004-consent-and-data-lifecycle.md) (data lifecycle) and the BSL
  "Tindalabs-hosted only" model.
- Distributed tracing / metrics / off-box logs remain deferred; the wiring already exists,
  so phase 2 is a config + reconciliation task, not a rebuild.

Relates to [ADR-0003](0003-otel-bridge.md) (the OTel bridge) and
[ADR-0004](0004-consent-and-data-lifecycle.md).
