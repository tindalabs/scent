# Migrating from FingerprintJS

This guide covers the conceptual and practical differences between FingerprintJS (Pro or open-source) and Scent, and walks through a migration.

## The core difference

FingerprintJS produces a **deterministic visitor ID**: a hash of collected signals. Two sessions with identical signals get the same ID. One signal change → different hash → different ID.

Scent produces a **probabilistic confidence score**: a 0–1 float representing how likely two snapshots are from the same entity. A browser update changes 2 signals out of 20; Scent returns `confidence: 0.91` and `continuity: confirmed`.

Scent is not a drop-in replacement — it is a different model. The migration involves rethinking how you use the identity signal in your application logic.

## Mapping concepts

| FingerprintJS | Scent | Notes |
|---|---|---|
| `visitorId` | `obs.identity.id` | Scent ID persists across storage resets via server-side resurrection |
| `confidence.score` | `obs.identity.confidence` | Scent score is calibrated 0–1; FP confidence is 0–1 within a single device |
| N/A | `obs.identity.continuity` | `confirmed` / `probable` / `uncertain` / `unknown` — actionable band |
| N/A | `obs.drift` | Delta between consecutive snapshots |
| N/A | `obs.risk` | Composite anomaly score with named flags |
| `requestId` | snapshot `event_id` (server-generated) | Idempotent deduplication |
| `linkedId` | N/A | Use your own user ID in downstream logic |

## Code migration

### Before (FingerprintJS Pro)

```typescript
import FingerprintJS from '@fingerprintjs/fingerprintjs-pro';

const fp = await FingerprintJS.load({ apiKey: 'your-fp-key' });
const result = await fp.get();

if (result.visitorFound) {
  // returning visitor
  allowAccess(result.visitorId);
} else {
  // new visitor
  challengeUser();
}
```

### After (Scent)

```typescript
import { init } from '@tindalabs/scent-sdk';

const sdk = init({
  apiKey: 'your-scent-key',
  endpoint: 'https://your-scent-server/v1',
  persistence: 'balanced',
});

const obs = await sdk.observe();
await sdk.flush();

if (obs.identity.continuity === 'confirmed' || obs.identity.continuity === 'probable') {
  // returning entity with high confidence — equivalent to visitorFound
  allowAccess(obs.identity.id);
} else if (obs.identity.continuity === 'uncertain') {
  // significant drift — step-up auth
  challengeUser(obs.identity.id);
} else {
  // unknown — new entity or cannot establish continuity
  challengeUser(null);
}

// Additionally: act on risk flags
if (obs.risk.score > 0.6 || obs.risk.flags.includes('automation_suspected')) {
  blockOrChallenge();
}
```

## Key behavioral differences

### Storage resets

FingerprintJS generates a new visitor ID if localStorage is cleared. Scent attempts server-side resurrection: if the signal profile matches a known identity closely enough, it returns the existing ID with a lower confidence score, not a new one.

### VPN / IP changes

FingerprintJS may produce a different ID. Scent's stable signals (canvas, audio, fonts, hardware) are IP-independent, so VPN changes typically produce `confidence > 0.80` on a known device.

### Browser updates

FingerprintJS often produces a different hash after a browser update (user agent and rendering changes together). Scent typically returns `continuity: probable` (0.65–0.84) because the stable hardware and font signals persist.

### Private / incognito mode

FingerprintJS cannot recover identity across private browsing sessions. Scent cannot either for storage-based signals, but the signal profile match against the server can still produce `probable` continuity if the stable hardware signals match a known identity.

## Persistence policies vs FingerprintJS collection

FingerprintJS Pro collects signals at Fingerprint's discretion and does not expose a compliance configuration. Scent's `PersistencePolicy` gives you explicit control over what is collected and stored. The `conservative` policy collects only highly-stable signals and writes nothing to cross-session storage — usable as a GDPR-safe minimal tracking mode.

See [Persistence Policies](persistence-policies.md) for a full breakdown.

## Observatory vs FingerprintJS dashboard

FingerprintJS Pro provides a dashboard for visitor lookup. The Scent Observatory (self-hosted at `localhost:4000`) provides:

- Identity list with confidence, risk, and last-seen
- Per-identity drift timeline with signal-level change history
- Cluster view for coordinated behavior detection
- Risk dashboard with anomaly breakdowns

## Running both in parallel

You can run Scent alongside FingerprintJS during a transition period. The two SDKs are independent and do not interfere. Use Scent's `continuity` and `risk` fields to inform decisions while keeping FingerprintJS as a fallback until you have validated Scent's signal quality on your traffic.

```typescript
const [fpResult, scentObs] = await Promise.all([
  fp.get(),
  sdk.observe().then(obs => sdk.flush().then(() => obs)),
]);

// Compare: do they agree on returning vs new?
const fpReturning = fpResult.visitorFound;
const scentReturning = scentObs.identity.continuity !== 'unknown';
```

Log disagreements to measure Scent's accuracy on your specific user population before switching over completely.
