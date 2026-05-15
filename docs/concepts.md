# Scent Concepts

This document explains the core concepts behind the Scent identity platform. It is intended for engineers integrating the SDK, architects evaluating the system, and anyone who wants to understand what Scent does and why it works the way it does.

---

## The problem: hostile browser environments

Deterministic identity in the browser has always been fragile. Cookie-based tracking breaks the moment a user clears their cookies, switches to a private window, or installs an ad blocker. Deterministic device fingerprinting — computing a hash from a fixed set of browser properties — breaks the moment any of those properties change.

Browser environments are under continuous pressure to become less fingerprintable. Anti-fingerprinting tools add noise to canvas rendering, spoof hardware concurrency, and randomize audio processing. VPNs rotate IP addresses. Browser updates change font rendering, WebGL behavior, and the values of dozens of other properties. Users upgrade their operating systems, swap monitors, or change their locale settings.

The result: a single real user on a single device generates many distinct apparent identities over time. Deterministic approaches cannot distinguish "same user, browser updated" from "entirely different user". This makes them unreliable for the use cases that matter most — detecting free tier abuse, flagging account takeover attempts, and maintaining continuity in fraud investigation workflows.

---

## Scent vs fingerprinting

Traditional fingerprinting computes a hash over a fixed set of browser properties. Any change to any property produces a completely different hash. A single major browser update can flip the hash even though 18 of 20 signals are unchanged.

Scent takes a different approach. Rather than asking "is this hash identical?", it asks "how similar is this signal set to a previously observed signal set?" Similarity is measured as a calibrated probability, not a binary match.

When a browser updates and two canvas-rendering signals change while 18 others remain stable, Scent returns a confidence of approximately 0.88 — high enough to confirm continuity — rather than treating the visitor as a new entity. The same logic handles gradual signal drift, partial spoofing, and VPN-induced attribute changes without failing catastrophically.

The generated identifier is called a **scent**, not a fingerprint. This reflects the probabilistic nature of the mechanism: a scent is a persistent, recognizable pattern — not a unique cryptographic identifier.

---

## Signals

A signal is a single measurable browser property. Scent collects signals across several domains: canvas rendering, WebGL parameters, audio processing, fonts, screen geometry, hardware capabilities, locale and timezone, installed plugins, network characteristics, and entropy-spoofing indicators.

Signals are assigned a stability class that controls their weight in the identity model:

- **Stable** — rarely or never changes for a real user on the same device. Canvas hash, audio hash, font list. Base weight: 0.9.
- **Moderate** — changes infrequently, typically on browser or OS upgrades. Screen resolution, locale, installed plugins. Base weight: 0.55.
- **Volatile** — can change between sessions. Network type, anti-tamper flags. Base weight: 0.15.

Weights decay over time and degrade further when a signal is absent from consecutive observations. This means that a signal which was once meaningful but has stopped appearing contributes progressively less to identity continuity.

Full signal definitions, browser support notes, and GDPR legal basis annotations are in the [Signal Reference](signals.md).

---

## Identity resolution

When `sdk.observe()` is called, the following happens:

1. **Signal collection** — all collectors run in parallel in the browser. The resulting snapshot is a flat key-value map of signal tokens.
2. **SimHash candidate lookup** — the snapshot is hashed using SimHash, which preserves locality: similar signal sets produce similar hashes. The server queries its SimHash index (stored in Postgres) to retrieve candidate identities whose hashes fall within a configurable Hamming distance of the incoming snapshot.
3. **Weighted Jaccard similarity** — for each candidate, the engine computes the weighted Jaccard similarity between the incoming token set and the stored token set. Weights reflect stability class, time decay since last observation, and absence decay.
4. **Confidence calibration** — the raw similarity score is passed through a calibration layer that adjusts for known noise sources (browser version bands, known VPN ASNs, entropy-spoofing signatures) to produce a final confidence score in the range [0, 1].
5. **Resolution** — the highest-confidence candidate above threshold is selected as the matched identity. If no candidate exceeds the minimum threshold, the observation is recorded as a new identity.

The server-side component is required for probabilistic matching. The SDK alone — without server communication — can only provide binary Phase-1 confidence based on local storage state.

---

## Confidence and continuity

The resolved identity includes a `confidence` value in the range [0, 1]. This score is interpreted in four bands:

- **confirmed** (≥ 0.85) — the same stable signals are present with only minor drift. Continuity is established with high certainty.
- **probable** (≥ 0.60) — some signals have changed, but the overall pattern still strongly suggests the same entity. Continuity is likely.
- **uncertain** (≥ 0.35) — significant drift has occurred. The match is plausible but not reliable enough to act on alone. Consider prompting re-authentication.
- **unknown** (< 0.35) — continuity cannot be established. Treat this observation as a new entity.

The confidence band is available directly on the resolved identity: `obs.identity.confidence`. The raw score and per-signal breakdown are also exposed for use cases that require explainability.

---

## Drift

Drift is the measured delta between two consecutive snapshots for the same identity. It quantifies how much the signal set has changed between observations.

Drift is characterized by two properties: **entropy magnitude** (how many signals changed, and how stable those signals were) and **classification**:

- **Minor** — volatile signals changed; stable signals are intact.
- **Moderate** — one or two moderate-stability signals changed. Expected on browser minor updates.
- **Significant** — several moderate or stable signals changed. Expected on major browser updates or OS upgrades.
- **Suspicious** — the pattern of change is inconsistent with organic browser evolution.

Tracking drift history over many observations yields useful signals of its own. Unusually rapid drift, VPN-rotation patterns, and entropy instability that matches known anti-fingerprinting tool signatures can all be detected from the drift sequence rather than from any single snapshot.

---

## Risk scoring

Confidence and risk are separate dimensions. A low-confidence match is not necessarily high risk — it may simply represent a user on a new device. A high-confidence match is not necessarily low risk — automation frameworks can replay known signal sets with high fidelity.

The composite risk score is a value in the range [0, 1] computed by a set of independent detectors:

- **Impossible transition** — the signal delta between two observations is physically impossible to achieve in the elapsed time.
- **Entropy instability** — signal noise patterns are inconsistent with organic browser behavior.
- **Storage amnesia** — persistent storage identifiers are absent despite prior observations from the same network or signal cluster.
- **Rapid re-registration** — a new identity appears immediately after an existing identity is flagged or blocked.
- **Coordinated behavior** — multiple identities exhibit synchronized observation patterns.

Risk bands: **low** (< 0.25), **medium** (< 0.55), **high** (< 0.80), **critical** (≥ 0.80).

---

## Persistence policies

Persistence policies control what Scent writes to browser storage and transmits to the server. They are the primary compliance and legal lever — the mechanism through which engineering teams adapt Scent's behavior to their regulatory environment.

Four tiers are available: **conservative**, **balanced**, **aggressive**, and **forensic**. Conservative minimizes data retention and suits strict consent-first deployments. Forensic retains the maximum signal surface for high-stakes fraud investigation. Balanced and aggressive sit between these extremes.

Persistence policies are set at initialization and scoped to the lifetime of the SDK instance. They cannot be changed per-observation, because per-call overrides would create audit inconsistencies: a single identity could be observed under different policies in the same session, making compliance reporting unreliable.

Full tier definitions are in [Persistence Policies](persistence-policies.md).

---

## The identity lifecycle

A scent begins its lifecycle as **new**: no prior observations, no confidence score, no history.

After enough observations accumulate, it transitions to **confirmed** — the identity has a stable pattern, a confidence band, and a drift history.

When significant drift occurs, the identity enters a **drifting** state. Continued observations from the same entity allow the engine to absorb the drift and re-confirm the identity with an updated signal baseline.

When two previously-distinct identities are resolved as the same entity — for example, a user observed on two different browsers who then authenticates on both — they are merged into a **cluster**. Cluster linking preserves the observation history of both identities and exposes the merged view through the API.

---

## Architecture

The platform has four layers:

- **SDK** (`@irregular/scent-sdk`) — runs in the browser. Collects signals, manages local persistence according to the active policy, and posts observation events to the server.
- **Server** (`@irregular/scent-server`) — receives events at `POST /v1/events`, runs the identity engine, maintains the SimHash index and identity records in Postgres, and caches hot identity state in Redis.
- **Identity engine** (`@irregular/scent-engine`) — implements SimHash candidate retrieval, weighted Jaccard scoring, confidence calibration, drift classification, and risk detection.
- **Observatory** — a React + Vite dashboard for exploring identities, confidence trends, drift history, and risk events.

The SDK is the only component that runs in the browser. The identity engine and its Postgres-backed index are server-side. Operating the SDK without a server degrades the system to binary local-storage matching — functional for Phase 1 development but not representative of production behavior.
