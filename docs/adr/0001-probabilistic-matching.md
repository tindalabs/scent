# ADR-0001: Probabilistic matching via SimHash + Jaccard similarity

**Status:** Accepted
**Date:** 2026-05-14

## Context

Browser fingerprint matching has two broad approaches:

1. **Deterministic hash matching** — compute a single hash of all signals; two sessions match if and only if their hashes are identical.
2. **Probabilistic similarity matching** — compute a similarity score between two signal sets; declare a match if the score exceeds a calibrated threshold.

Deterministic matching is simple but brittle: a single changed signal (browser update, new font, VPN) produces a completely different hash and breaks continuity. This is the root problem FingerprintJS users report most — sessions that belong to the same person are treated as new visitors after any browser update.

Our target environment is explicitly hostile: users may clear storage, switch networks, update browsers, or use anti-fingerprinting tools. Deterministic matching cannot serve this use case.

## Decision

Use **SimHash** for fast candidate retrieval and **Jaccard similarity** for per-signal scoring.

**SimHash** produces a compact bit-vector from a signal set such that similar sets produce similar hashes. It allows O(log n) approximate-nearest-neighbor lookup against the identity store, which is necessary for scale — a flat similarity scan against all identities becomes prohibitive past ~100k records.

**Jaccard similarity** on signal token sets gives a baseline 0–1 similarity score. This is then refined by a **weighted per-signal comparison** that accounts for signal stability class (highly stable / moderately stable / volatile). A changed canvas hash reduces confidence more than a changed IP address.

The final output is a **calibrated 0–1 confidence score**, not a raw similarity value. Calibration maps "similarity 0.87" to "confidence 0.93 — probable same entity", using signal weight profiles tuned during development.

## Consequences

- Identity resolution requires a server-side component (the SimHash index lives in the database). Pure client-side identity is not possible.
- The matching engine must be tested against a diverse synthetic signal dataset to validate calibration. This is a Phase 2 milestone.
- False negatives (same entity classified as new) are preferable to false positives (distinct entities merged). The default confidence threshold for identity continuity should be tuned conservatively.
- Signal weight profiles will need maintenance as browser APIs evolve. The weight table must be version-controlled and decoupled from the matching algorithm.
