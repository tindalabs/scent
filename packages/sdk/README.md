# @tindalabs/scent-sdk

[![npm version](https://img.shields.io/npm/v/@tindalabs/scent-sdk.svg)](https://www.npmjs.com/package/@tindalabs/scent-sdk)
[![CI](https://github.com/tindalabs/scent/actions/workflows/ci.yml/badge.svg)](https://github.com/tindalabs/scent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![types](https://img.shields.io/npm/types/@tindalabs/scent-sdk.svg)](https://www.npmjs.com/package/@tindalabs/scent-sdk)

**Probabilistic identity continuity for hostile browser environments** — the Scent browser SDK.

Scent tells you whether a returning visitor is *likely the same entity* even after cookie deletion, VPN changes, browser updates, or anti-fingerprinting tools — using drift-tolerant confidence scoring, not deterministic hashes.

```bash
npm install @tindalabs/scent-sdk
```

## Quick start

```ts
import { init } from '@tindalabs/scent-sdk';

const sdk = init({ apiKey: 'your-api-key', persistence: 'balanced' });

const obs = await sdk.observe();   // collect signals, resolve identity
await sdk.flush();                  // send the snapshot to the server

console.log(obs.identity.confidence);  // 0.91
console.log(obs.identity.continuity);  // "confirmed"
console.log(obs.risk.score);           // 0.07
```

## Linking identities to accounts

Call `identify()` after login to associate the resolved device identity with an application account ID. This powers the "how many accounts share this device?" fraud query. Account IDs are opaque application strings — never PII.

```ts
await sdk.observe();
await sdk.identify(currentUser.id);   // no-op if no identity resolved yet
```

## API

| Method | Description |
|---|---|
| `init(options)` | Create a `ScentSDK`. Options: `apiKey`, `endpoint?`, `persistence?`, `traceparentProvider?`. |
| `observe(opts?)` | Collect signals, recover/resolve the identity, return a `ScentObservation`. |
| `flush()` | POST buffered snapshots to the server (`/v1/events`). |
| `identify(accountId)` | Link the current identity to an account ID (`/v1/identity/:id/link`). |
| `snapshot()` | Collect raw signals without resolving or persisting identity. |
| `on(event, handler)` | Subscribe to SDK events (e.g. `identity_resolved`); returns an unsubscribe fn. |

## Privacy

Scent collects aggregate fingerprint signals (canvas, audio, fonts, hardware, locale) — never raw DOM content, keystrokes, or PII. `identify()` sends only the opaque account ID you pass in, in the request body (never in the URL).

## OpenTelemetry

Pair with [`@tindalabs/scent-otel`](https://www.npmjs.com/package/@tindalabs/scent-otel) to stamp identity/risk attributes onto your OTel spans and bridge `traceparent` for end-to-end trace correlation.

---

Part of [Scent](https://github.com/tindalabs/scent). MIT licensed.
