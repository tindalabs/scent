# OTel Bridge — `@tindalabs/scent-otel`

Scent can attach identity and risk context to every OpenTelemetry span in your application. This lets you answer questions like "which identity triggered this trace?" or "was this login event flagged as risky?" directly inside Grafana Tempo, Jaeger, or any other OTel-compatible backend.

## How it works

Two things happen when the bridge is active:

1. **Traceparent flows client → server.** At `observe()` time, the bridge reads the W3C `traceparent` from the current page trace and includes it in the snapshot payload. The server stores it on the snapshot row, and `GET /v1/identity/:id/timeline` returns it per drift event — so you can jump from an identity timeline directly into a Tempo trace.

2. **Scent attributes flow onto spans.** After `observe()` resolves, the bridge sets these attributes on the active span:

| Attribute | Type | Description |
|---|---|---|
| `scent.identity.id` | string | Resolved scent ID for this entity |
| `scent.identity.confidence` | float | 0–1 match confidence |
| `scent.identity.continuity` | string | `confirmed` / `probable` / `uncertain` / `unknown` |
| `scent.identity.is_new` | boolean | `true` if this is the first observation |
| `scent.risk.score` | float | 0–1 composite risk score |
| `scent.risk.flags` | string | Comma-separated active flag codes, e.g. `automation_suspected,storage_amnesia` |

## Requirements

- `@opentelemetry/api` ≥ 1.0.0 must be installed by your application. The bridge uses only the stable API layer.
- The bridge is a no-op when no active span exists. It never throws.

## Installation

```bash
npm install @tindalabs/scent-sdk @tindalabs/scent-otel
# @opentelemetry/api is a peer dep — install it alongside your OTel SDK
```

## Usage

### With `@tindalabs/blindspot` (recommended)

`@tindalabs/blindspot` manages a long-lived route span for the page. Because browser OTel context propagation doesn't survive async boundaries, you should use `getSessionTraceparent()` from `@tindalabs/blindspot` directly rather than relying on `readTraceparent()` from the OTel API. `getSessionTraceparent()` reads the stored route span directly, so it works regardless of where in the call stack `observe()` runs.

```typescript
import { init } from '@tindalabs/scent-sdk';
import { getSessionTraceparent } from '@tindalabs/blindspot';  // reads the active route span
import { ScentOtelBridge } from '@tindalabs/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: getSessionTraceparent, // blindspot route span → snapshot
});

const bridge = new ScentOtelBridge(sdk);

const obs = await bridge.observe(); // traceparent captured + span annotated
await bridge.flush();               // sends snapshot with traceparent to server
```

`scent.identity.*` and `scent.risk.*` attributes are set on the active blindspot-ux span, so they appear on every child span (clicks, fetches, vitals) automatically — they inherit the trace context.

### Without `@tindalabs/blindspot`

When running without blindspot-ux, use `readTraceparent()` instead. This reads from `@opentelemetry/api`'s active span, which works when `observe()` is called synchronously inside a `startActiveSpan` callback.

```typescript
import { init } from '@tindalabs/scent-sdk';
import { ScentOtelBridge, readTraceparent } from '@tindalabs/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: readTraceparent,
});

const bridge = new ScentOtelBridge(sdk);

tracer.startActiveSpan('login', async (span) => {
  const obs = await bridge.observe(); // span is active here — traceparent captured
  await bridge.flush();
  span.end();
});
```

### Manual wiring

If you prefer not to use the `ScentOtelBridge` wrapper:

```typescript
import { init } from '@tindalabs/scent-sdk';
import { getSessionTraceparent } from '@tindalabs/blindspot';
import { attachScentAttributes } from '@tindalabs/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: getSessionTraceparent,
});

const obs = await sdk.observe();
attachScentAttributes(obs);  // attaches to the currently active span
await sdk.flush();
```

`attachScentAttributes` also accepts an explicit span as a second argument:

```typescript
import { trace } from '@opentelemetry/api';
attachScentAttributes(obs, trace.getActiveSpan());
```

## React example

```tsx
import { init } from '@tindalabs/scent-sdk';
import { getSessionTraceparent } from '@tindalabs/blindspot';
import { ScentOtelBridge } from '@tindalabs/scent-otel';
import { useEffect } from 'react';

const sdk = init({ apiKey: '...', traceparentProvider: getSessionTraceparent });
const bridge = new ScentOtelBridge(sdk);

function LoginPage() {
  useEffect(() => {
    bridge.observe().then(() => bridge.flush());
  }, []);
}
```

## Server-side spans

When the server has OTel enabled, it emits two spans per ingested event:

| Span name | Attributes |
|---|---|
| `scent.identity_resolution` | `scent.identity.input_id`, `scent.identity.id`, `scent.identity.is_new`, `scent.identity.confidence`, `scent.traceparent` |
| `scent.risk_assessment` | `scent.identity.id`, `scent.snapshot.id`, `scent.identity.is_new`, `scent.risk.score`, `scent.risk.band`, `scent.risk.flag_count` |

The server also auto-instruments HTTP requests, PostgreSQL queries, and Redis calls via `@opentelemetry/auto-instrumentations-node`.

## Server configuration

| Environment variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP receiver (e.g. OTel Collector, Grafana Alloy) |
| `OTEL_SERVICE_NAME` | — | Service name shown in your tracing backend |
| `OTEL_SERVICE_VERSION` | — | Service version tag |
| `OTEL_SDK_DISABLED` | `false` | Set to `true` to disable tracing entirely |

The Docker Compose dev stack already includes an OTel Collector sidecar. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at it and traces will appear in Grafana Tempo.

## Trace continuity model

```
Browser                          Server                        Tracing backend
───────                          ──────                        ───────────────
@tindalabs/blindspot creates route span
  └─ stored as _routeSpan
       │
       ▼
getSessionTraceparent() ────────► POST /v1/events (traceparent in payload)
  reads _routeSpan directly         └─ stored on snapshot row
  (no async context needed)         └─ scent.identity_resolution span
                                         └─ scent.traceparent = 00-abc-…
                                              │
                                              ▼
attachScentAttributes()               Tempo trace includes
  sets scent.* on route span  ──────► scent.identity.id + risk on all
  → inherited by child spans           child spans (clicks, fetches…)
```

This lets you filter traces by identity, correlate fraud signals with specific user interactions, or jump from an identity's drift timeline into the exact Tempo trace that triggered it.
