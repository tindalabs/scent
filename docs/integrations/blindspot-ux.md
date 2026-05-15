# Scent + blindspot-ux

Scent and `@tindalabs/blindspot` are designed to compose. When both are active, every OpenTelemetry span in your application carries identity and risk context — so you can answer "who triggered this trace?" directly in Grafana Tempo.

This guide covers the recommended integration path. For the standalone OTel bridge (without `@tindalabs/blindspot`), see [otel-bridge.md](otel-bridge.md).

## How the composition works

`@tindalabs/blindspot` creates a long-lived route span for each page and stores it in a module-level variable (`_routeSpan`). `getSessionTraceparent()` reads that span directly and returns a W3C `traceparent` string — bypassing OTel's async context propagation, which does not survive promise chains in browsers.

Scent reads this traceparent via `traceparentProvider` at `observe()` time and includes it in the snapshot payload. The server stores it on the snapshot row. The `GET /v1/identity/:id/timeline` endpoint returns it per drift event, so you can jump from an identity timeline directly into a Tempo trace.

## Installation

```bash
npm install @tindalabs/scent-sdk @tindalabs/scent-otel @tindalabs/blindspot
```

## Setup

```typescript
import { init } from '@tindalabs/scent-sdk';
import { getSessionTraceparent } from '@tindalabs/blindspot';
import { ScentOtelBridge } from '@tindalabs/scent-otel';

const sdk = init({
  apiKey: 'your-api-key',
  traceparentProvider: getSessionTraceparent,
});

const bridge = new ScentOtelBridge(sdk);
```

## Usage

```typescript
const obs = await bridge.observe();
await bridge.flush();
```

After `bridge.observe()` resolves, these attributes are set on the active `@tindalabs/blindspot` route span:

| Attribute | Value |
|---|---|
| `scent.identity.id` | Resolved scent ID |
| `scent.identity.confidence` | 0–1 match confidence |
| `scent.identity.continuity` | `confirmed` / `probable` / `uncertain` / `unknown` |
| `scent.identity.is_new` | `true` if first observation |
| `scent.risk.score` | 0–1 composite risk score |
| `scent.risk.flags` | Comma-separated flag codes |

Because these are set on the route span, all child spans — clicks, fetches, web vitals — inherit them automatically via trace context propagation.

## React example

```tsx
import { init } from '@tindalabs/scent-sdk';
import { getSessionTraceparent } from '@tindalabs/blindspot';
import { ScentOtelBridge } from '@tindalabs/scent-otel';
import { useEffect } from 'react';

const sdk = init({ apiKey: '...', traceparentProvider: getSessionTraceparent });
const bridge = new ScentOtelBridge(sdk);

function App() {
  useEffect(() => {
    bridge.observe().then(() => bridge.flush());
  }, []);
}
```

## Why `getSessionTraceparent()` instead of `readTraceparent()`

`readTraceparent()` from `@tindalabs/scent-otel` uses `trace.getActiveSpan()` from `@opentelemetry/api`. This works when `observe()` is called synchronously inside a `startActiveSpan` callback but fails across `await` boundaries in browsers — OTel's async context does not propagate through browser Promise microtasks.

`getSessionTraceparent()` reads `_routeSpan` from `@tindalabs/blindspot`'s module scope directly, bypassing context propagation entirely. It works regardless of where in the call stack `observe()` runs.

Use `readTraceparent()` only when `@tindalabs/blindspot` is not present and you can guarantee `observe()` runs synchronously within an active span callback.

## Trace continuity diagram

```
Browser                          Server                        Tempo
───────                          ──────                        ─────
@tindalabs/blindspot creates route span
  └── stored as _routeSpan
        │
        ▼
getSessionTraceparent() ────────► POST /v1/events
  reads _routeSpan directly         └── traceparent stored on snapshot
  (no async context needed)         └── scent.identity_resolution span
                                          └── scent.traceparent = 00-abc…

bridge.observe() sets               Identity timeline links
scent.* on route span  ────────►    to Tempo trace ID
  → inherited by child spans        Filter traces by identity
```

## Querying by identity in Tempo

Once the integration is live, you can filter Grafana Tempo traces using:

```
{ .scent.identity.id = "abc123..." }
{ .scent.risk.score > 0.6 }
{ .scent.identity.continuity = "unknown" }
```

Or jump from an identity's drift timeline in the Observatory directly into the Tempo trace that triggered the drift event.
