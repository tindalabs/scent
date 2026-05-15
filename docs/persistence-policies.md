# Persistence Policies

This document is the authoritative reference for Scent's four persistence policies. It is intended for engineers integrating the SDK, DPOs auditing data handling, and legal counsel evaluating GDPR compliance posture.

> **Disclaimer:** The GDPR notes in this document are informational only. They describe how each policy was designed to map to legal bases under GDPR but do not constitute legal advice. Consult qualified legal counsel before determining the appropriate policy for your deployment.

---

## Overview

The `PersistencePolicy` config option controls two things:

1. **Which browser storage layers** the SDK writes identity data to after an `observe()` call.
2. **Which signals are transmitted** to the server for identity resolution and risk assessment.

It does not control signal collection. All configured collectors run on every `observe()` call regardless of policy. The policy determines what happens with the collected data after collection. See [signals.md](signals.md) for the full signal reference.

**SDK usage:**

```typescript
import { init } from '@tindalabs/scent-sdk';

const sdk = init({ apiKey: '...', persistence: 'balanced' });
```

`'balanced'` is the default if `persistence` is omitted.

---

## Policy reference

### `conservative`

Minimal footprint. Designed for deployments where data minimisation is a hard requirement.

**Purpose:** Limit persistence to the lifetime of the current tab. No cross-session identity material is written to the browser. Only the most stable signals are sent to the server, reducing the amount of data processed to what is strictly necessary for continuity detection within a session.

**SDK config:**

```typescript
const sdk = init({ apiKey: '...', persistence: 'conservative' });
```

**Storage layers written:**

| Layer | Written |
|---|---|
| `sessionStorage` | Yes |
| `localStorage` | No |
| `IndexedDB` | No |
| First-party cookie | No |
| ETag / Cache Storage | No |
| WebRTC local IP | No |

**Signals sent to server:** Highly-stable signals only — `canvas.*`, `audio.*`, `hardware.concurrency`, `fonts.list`. See [signals.md](signals.md) for stability classifications.

**Server-side IP handling:** IP is not collected or stored.

**When to use:** Strict GDPR interpretations where consent has not been obtained. Healthcare or financial services deployments with additional sector-specific constraints. Products offering users an explicit "minimal tracking" mode as a first-class feature.

---

### `balanced`

Standard operation. The default policy.

**Purpose:** Full cross-session identity continuity using conventional browser storage, without enabling opt-in signals that carry higher regulatory risk. IP is retained for risk assessment but excluded from identity matching.

**SDK config:**

```typescript
const sdk = init({ apiKey: '...', persistence: 'balanced' });
```

**Storage layers written:**

| Layer | Written |
|---|---|
| `sessionStorage` | Yes |
| `localStorage` | Yes |
| `IndexedDB` | Yes |
| First-party cookie | No |
| ETag / Cache Storage | No |
| WebRTC local IP | No |

**Signals sent to server:** All standard signals. Opt-in signals (WebRTC local IP, battery) are excluded regardless of collector configuration.

**Server-side IP handling:** IP is stored and used for risk assessment (velocity, geo-anomaly detection). It is not used as a signal in identity matching.

**When to use:** Typical SaaS products operating under GDPR with valid consent in place. The correct starting point for any new integration.

---

### `aggressive`

Maximum persistence for fraud-fighting deployments.

**Purpose:** Exploit every available storage layer to survive "Clear browsing data" events, private browsing mode switches, and localStorage isolation. ETag-assisted continuity delegates resurrection to the server when client-side storage has been fully cleared.

**SDK config:**

```typescript
const sdk = init({ apiKey: '...', persistence: 'aggressive' });
```

**Storage layers written:**

| Layer | Written |
|---|---|
| `sessionStorage` | Yes |
| `localStorage` | Yes |
| `IndexedDB` | Yes |
| First-party cookie | Yes — server-issued, `HttpOnly`, `SameSite=Strict` |
| ETag / Cache Storage | Yes — server drives ETag-based continuity |
| WebRTC local IP | No |

**Signals sent to server:** All standard signals. Server-side resurrection is attempted on new sessions where no stored identity is found on the client.

**Server-side IP handling:** IP is stored and used for both risk assessment and as supporting context in resurrection attempts.

**When to use:** Products where fraud prevention is a primary product requirement and users have given explicit, informed consent to persistent tracking for this purpose. Not appropriate as a default for general SaaS products.

---

### `forensic`

Full signal collection for investigation workflows.

**Purpose:** Collect the maximum possible signal set, including opt-in network-layer signals such as WebRTC local IP. Intended for bounded investigation windows (incident response, coordinated abuse investigation), not for continuous production collection against all users.

**SDK config:**

```typescript
const sdk = init({ apiKey: '...', persistence: 'forensic' });
```

**Storage layers written:**

| Layer | Written |
|---|---|
| `sessionStorage` | Yes |
| `localStorage` | Yes |
| `IndexedDB` | Yes |
| First-party cookie | Yes |
| ETag / Cache Storage | Yes |
| WebRTC local IP | Yes — collected and transmitted |

**Signals sent to server:** All standard signals plus all opt-in signals (`network.webrtcLocalIp`, `hardware.battery.*`). See [signals.md](signals.md) for the full opt-in signal list.

**Server-side IP handling:** IP is stored, used in identity matching, and retained for the duration of the investigation window.

**When to use:** Incident response and coordinated abuse investigations where a specific legal basis for extended collection is in place. This policy must not be applied to all users by default. Scope it to identified suspect cohorts and define a time-bounded collection window before deployment.

---

## Storage layer reference

| Layer | Survives browser close | Survives "Clear browsing data" | Notes |
|---|---|---|---|
| `sessionStorage` | No | N/A — lost on tab close | Tab-scoped. Isolated per origin. |
| `localStorage` | Yes | No | Cleared by standard "Clear browsing data" flows in all major browsers. |
| `IndexedDB` | Yes | Partial — browser-dependent | Some browsers (e.g. Firefox with strict ETP) isolate or clear IndexedDB earlier than localStorage. |
| First-party cookie | Yes | No — cleared alongside localStorage | Server-issued. Survives localStorage wipes if the user clears storage without clearing cookies, or vice versa. |
| ETag / Cache Storage | Yes | Partial | Cache is cleared separately from localStorage and cookies in most browser UIs, providing an additional recovery vector. |
| WebRTC local IP | N/A — not stored | N/A | Collected per `observe()` call and transmitted. Not written to browser storage. |

---

## GDPR legal basis mapping

Signal collection and signal persistence are governed separately. The policy controls what is persisted and transmitted; whether the underlying `observe()` call is lawful depends on the legal basis in place at the time of collection.

| Policy | Recommended legal basis | Notes |
|---|---|---|
| `conservative` | Legitimate interest or consent | Legitimate interest may be arguable given the minimal footprint, but legal review is required for your specific context. |
| `balanced` | Consent | The cross-session persistence created by `localStorage` and `IndexedDB` writes typically requires consent under GDPR. |
| `aggressive` | Explicit consent | Cookie writes and server-side resurrection are processing activities that require clear, freely-given, specific, informed, and unambiguous consent. |
| `forensic` | Explicit consent or legal obligation | WebRTC IP collection and extended retention require a strong legal basis. Legal obligation (e.g. fraud prevention under a regulatory requirement) or explicit consent with documented scope and duration. |

Switching policies between requests for the same user is not supported. The policy is set at `init()` time and applies for the lifetime of the SDK instance. This is intentional: per-call overrides would allow a single identity to be observed under different policies in the same session, making compliance reporting unreliable.
