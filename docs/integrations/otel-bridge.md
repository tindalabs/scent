# OTel Bridge — `@irregular/scent-otel`

Scent can attach identity and risk context to every OpenTelemetry span in your application. This lets you answer questions like "which identity triggered this trace?" or "was this login event flagged as risky?" directly inside Grafana Tempo, Jaeger, or any other OTel-compatible backend.

## How it works

Two things happen when the bridge is active:

1. **Traceparent flows client → server.** At `observe()` time, the bridge reads the W3C `traceparent` from the currently active OTel span and includes it in the snapshot payload. The server stores it on the snapshot row, and `GET /v1/identity/:id/timeline` returns it per drift event — so you can jump from an identity timeline directly into a Tempo trace.

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

- `@opentelemetry/api` ≥ 1.0.0 must be installed by your application. The bridge uses only the stable API layer — it works with any OTel SDK (Node, browser, Deno).
- The bridge is a no-op when no active span exists. It never throws.

## Installation

```bash
npm install @irregular/scent-sdk @irregular/scent-otel
# @opentelemetry/api is a peer dep — install it alongside your OTel SDK
```

## Usage

### Option A — `ScentOtelBridge` (recommended)

The bridge wraps the SDK and handles both directions automatically.

```typescript
import { init } from '@irregular/scent-sdk';
import { ScentOtelBridge, readTraceparent } from '@irregular/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: readTraceparent, // inject traceparent at observe() time
});

const bridge = new ScentOtelBridge(sdk);

// Inside an active OTel span:
const obs = await bridge.observe(); // traceparent captured + span annotated
await bridge.flush();               // sends snapshot with traceparent to server

// obs.identity.id, obs.identity.confidence, etc. are unchanged
```

### Option B — manual wiring

If you prefer not to use the wrapper class, wire the two functions yourself:

```typescript
import { init } from '@irregular/scent-sdk';
import { readTraceparent, attachScentAttributes } from '@irregular/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: readTraceparent,
});

const obs = await sdk.observe();
attachScentAttributes(obs);         // attaches to the currently active span
await sdk.flush();
```

`attachScentAttributes` also accepts an explicit span as a second argument if you want to target a specific span rather than the active one:

```typescript
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
attachScentAttributes(obs, span);
```

## React hook example

If you're using the SDK's React adapter, attach attributes inside a `useEffect` after the observation resolves:

```tsx
import { useScent } from '@irregular/scent-sdk/react';
import { attachScentAttributes } from '@irregular/scent-otel';
import { useEffect } from 'react';

function LoginPage() {
  const { observation, flush } = useScent();

  useEffect(() => {
    if (observation) {
      attachScentAttributes(observation);
      void flush();
    }
  }, [observation, flush]);
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
@blindspot/web creates span
  └─ traceparent: 00-abc-def-01
       │
       ▼
scent-otel reads traceparent ──► POST /v1/events (traceparent in payload)
                                   └─ stored on snapshot row
                                   └─ scent.identity_resolution span
                                        └─ scent.traceparent = 00-abc-def-01
                                             │
                                             ▼
                                         Tempo trace includes
                                         scent.identity.id + risk
```

This lets you filter traces by identity, or click through from an identity's drift timeline to the exact Tempo trace that triggered it.
