# Scent

**Probabilistic identity continuity for hostile browser environments.**

Scent tracks whether a returning visitor is "likely the same entity" even after cookie deletion, VPN changes, browser updates, or anti-fingerprinting tools — using a drift-tolerant confidence scoring engine, not deterministic hashes.

```typescript
import { init } from '@tindalabs/scent-sdk';

const sdk = init({ apiKey: 'your-api-key', persistence: 'balanced' });

const obs = await sdk.observe();
await sdk.flush();

console.log(obs.identity.confidence);  // 0.91
console.log(obs.identity.continuity);  // "confirmed"
console.log(obs.risk.score);           // 0.07
```

---

## Why not FingerprintJS?

FingerprintJS computes a hash. One signal changes → different hash → different visitor. In the real world users update browsers, switch VPNs, and clear cookies constantly. Scent uses **probabilistic similarity scoring**: 18 of 20 signals match → confidence 0.93, continuity `confirmed`.

| | FingerprintJS | Scent |
|---|---|---|
| Approach | Deterministic hash | Probabilistic similarity |
| Browser update | New visitor | 0.91 confidence |
| Cookie deletion | New visitor | Server-side resurrection |
| VPN change | New visitor | Stable signals still match |
| Explainability | Black box | Per-signal breakdown |
| Self-hostable | No | Yes |
| Open source | No | Yes |

---

## How it works

1. **`sdk.observe()`** — collects ~50 browser signals (canvas, audio, fonts, hardware, screen, locale, anti-tamper heuristics)
2. **`sdk.flush()`** — sends the snapshot to your Scent server
3. **Identity engine** — runs SimHash candidate lookup + weighted Jaccard similarity against your identity store
4. **Confidence score** — `0–1` float with a human-readable `continuity` band and per-signal explanation

Confidence bands:
- `confirmed` (≥ 0.85) — same stable signals, minor drift
- `probable` (≥ 0.60) — some signals changed, very likely same entity
- `uncertain` (≥ 0.35) — significant drift, worth re-authenticating
- `unknown` (< 0.35) — treat as new

---

## Quickstart

### 1. Start the stack

```bash
git clone https://github.com/tindalabs/scent
cd scent
docker compose up
```

This starts:
- **scent-server** on `localhost:3000` (identity API)
- **scent-observatory** on `localhost:4000` (identity UI)
- PostgreSQL, Redis, OTel Collector, Grafana Tempo

### 2. Install the SDK

```bash
npm install @tindalabs/scent-sdk
```

### 3. Instrument your app

```typescript
import { init } from '@tindalabs/scent-sdk';

const sdk = init({
  apiKey: 'your-api-key',        // from Observatory → Project Settings
  endpoint: 'https://your-scent-server/v1',
  persistence: 'balanced',       // conservative | balanced | aggressive | forensic
});

// On each significant interaction (login, signup, checkout):
const obs = await sdk.observe();
await sdk.flush();

// Use the result
if (obs.identity.continuity === 'unknown' || obs.risk.score > 0.6) {
  // Challenge this user — step-up auth, CAPTCHA, manual review
}
```

### 4. Open the Observatory

`http://localhost:4000` — browse identities, inspect signal profiles, see drift timelines, review risk flags.

---

## SDK reference

### `init(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Project API key |
| `endpoint` | `string` | `https://api.tindalabs.dev/v1` | Scent server URL |
| `persistence` | `PersistencePolicy` | `'balanced'` | Storage and collection scope |
| `traceparentProvider` | `() => string \| null` | — | OTel traceparent hook (see [OTel bridge](docs/integrations/otel-bridge.md)) |

### `sdk.observe()`

Collects signals, attempts to recover a prior identity from storage, and returns a `ScentObservation`. Does not make a network request.

```typescript
const obs = await sdk.observe();

obs.identity.id           // string — the persistent scent ID
obs.identity.confidence   // 0–1 float
obs.identity.isNew        // boolean — first-ever observation
obs.identity.continuity   // "confirmed" | "probable" | "uncertain" | "unknown"

obs.drift.detected        // boolean
obs.drift.delta           // string[] — signal names that changed
obs.drift.entropy         // float — magnitude of change

obs.risk.score            // 0–1 float (Phase 3, server-resolved)
obs.risk.flags            // string[] — e.g. ["automation_suspected", "vpn_detected"]
```

### `sdk.flush()`

Sends buffered snapshots to the server. Resolves when the server has ingested and scored them. Safe to call multiple times; no-ops when buffer is empty.

### `sdk.snapshot()`

Returns the current signal state without resolving or persisting identity. Useful for debugging signal collection.

### `sdk.storageHealth()`

Returns which storage layers are available in the current browser session.

---

## OpenTelemetry bridge

If your app uses OpenTelemetry, the `@tindalabs/scent-otel` bridge attaches identity and risk context to your existing spans:

```typescript
import { init } from '@tindalabs/scent-sdk';
import { ScentOtelBridge, readTraceparent } from '@tindalabs/scent-otel';

const sdk = init({ apiKey: '...', traceparentProvider: readTraceparent });
const bridge = new ScentOtelBridge(sdk);

const obs = await bridge.observe();  // span annotated with scent.identity.*
await bridge.flush();
```

Span attributes set: `scent.identity.id`, `scent.identity.confidence`, `scent.identity.continuity`, `scent.risk.score`, `scent.risk.flags`.

See [OTel bridge guide](docs/integrations/otel-bridge.md) for full setup including `@tindalabs/blindspot` integration.

---

## Self-hosting

### Environment variables

Copy `.env.example` and configure:

```bash
DATABASE_URL=postgresql://scent:password@localhost:5432/scent
REDIS_URL=redis://localhost:6379
PORT=3000

# OTel (optional)
OTEL_SERVICE_NAME=scent-server
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Database migrations

Migrations run automatically on server start. To run them standalone:

```bash
pnpm --filter @tindalabs/scent-server migrate
```

### Production Docker Compose

The included `docker-compose.yml` is production-ready. For HTTPS, put a reverse proxy (nginx, Caddy, Traefik) in front of `scent-server:3000`.

---

## Documentation

- [Concepts](docs/concepts.md) — probabilistic identity, drift, confidence, risk
- [Signal Reference](docs/signals.md) — every collected signal, stability class, GDPR notes
- [Persistence Policies](docs/persistence-policies.md) — storage scopes, compliance guide
- [REST API](docs/api.md) — full endpoint reference
- [OTel Bridge](docs/integrations/otel-bridge.md) — tracing integration guide
- [Migrating from FingerprintJS](docs/migrating-from-fingerprintjs.md)

---

## Architecture

```
@tindalabs/scent-sdk      (browser)
  ├── ~50 signal collectors
  ├── Multi-layer persistence (localStorage, IndexedDB, cookies, ETag)
  └── OTel traceparent bridge

@tindalabs/scent-server   (Node.js)
  ├── POST /v1/events — snapshot ingestion
  ├── SimHash + Jaccard identity engine
  ├── Drift detection + history
  ├── Risk scoring (6 anomaly detectors)
  └── REST query API

@tindalabs/scent-observatory  (React, port 4000)
  ├── Identity list + detail pages
  ├── Drift timeline visualization
  └── Risk dashboard
```

---

## The Tindalabs stack

Scent is one of three composable browser-layer packages:

| Package | What it does |
|---|---|
| **[@tindalabs/blindspot](https://github.com/tindalabs/blindspot)** | Privacy-first OTel frontend observability |
| **[@tindalabs/shield](https://github.com/tindalabs/shield)** | Tamper detection & active content protection |
| **[@tindalabs/scent](https://github.com/tindalabs/scent)** | Probabilistic identity continuity |

### Integrating Shield signals

Pass `@tindalabs/shield` assessment results directly into `observe()` so the server's risk engine sees tamper signals alongside the browser fingerprint:

```ts
import { init } from '@tindalabs/scent-sdk';
import { assess } from '@tindalabs/shield';

const scent = init({ apiKey: '...', endpoint: '...' });
const shield = await assess();

const obs = await scent.observe({
  extraSignals: shield.signals,
});
await scent.flush();
```

The `shield.*` signals become first-class fields in the stored snapshot and are visible in drift timelines and risk assessments in the Observatory.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [tindalabs.dev](https://tindalabs.dev).
