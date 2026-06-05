# @tindalabs/scent-otel

[![npm version](https://img.shields.io/npm/v/@tindalabs/scent-otel.svg)](https://www.npmjs.com/package/@tindalabs/scent-otel)
[![CI](https://github.com/tindalabs/scent/actions/workflows/ci.yml/badge.svg)](https://github.com/tindalabs/scent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![types](https://img.shields.io/npm/types/@tindalabs/scent-otel.svg)](https://www.npmjs.com/package/@tindalabs/scent-otel)

**The OpenTelemetry bridge for Scent** — stamp identity and risk signals onto your OTel spans and correlate browser traces with the server.

```bash
npm install @tindalabs/scent-otel
```

## Why

If you already emit OTel spans (e.g. via [`@tindalabs/blindspot`](https://www.npmjs.com/package/@tindalabs/blindspot)), this bridge attaches Scent's identity/risk verdict as span attributes — so "this session is a high-risk, coordinated-account device" shows up right next to the rest of your telemetry, and the browser↔server trace stays connected via W3C `traceparent`.

## Usage

```ts
import { init } from '@tindalabs/scent-sdk';
import { readTraceparent, attachScentAttributes } from '@tindalabs/scent-otel';

// 1 — feed the active trace's traceparent into Scent so the server span links up
const sdk = init({ apiKey: 'your-api-key', traceparentProvider: readTraceparent });

// 2 — stamp the resolution verdict onto the current span
const obs = await sdk.observe();
attachScentAttributes(span, obs);
```

## Exports

| Export | Description |
|---|---|
| `readTraceparent()` | Read the active W3C `traceparent` for the current trace context. |
| `attachScentAttributes(span, observation)` | Set `scent.identity.*` / `scent.risk.*` attributes on a span. |
| `ScentOtelBridge` | Higher-level helper that wires observe → span attributes automatically. |
| `ATTR_IDENTITY_ID`, `ATTR_RISK_SCORE`, … | The semantic-attribute key constants. |

---

Part of [Scent](https://github.com/tindalabs/scent). MIT licensed.
