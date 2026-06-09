# @tindalabs/scent-bench

A reproducible accuracy benchmark comparing **Scent's probabilistic matching**
against **deterministic fingerprint hashing** (FingerprintJS OSS / ThumbmarkJS
style) under realistic identity drift.

```bash
pnpm bench          # from the repo root
# or
pnpm --filter @tindalabs/scent-bench bench
```

Results are printed to the console and written to [`RESULTS.md`](./RESULTS.md).

## Why this exists

Scent's core claim is that probabilistic similarity scoring re-identifies
returning visitors **after drift** (browser updates, VPNs, anti-fingerprinting,
new hardware) where a deterministic hash mints a brand-new visitor. In a
high-scrutiny category that claim needs numbers, not adjectives. This benchmark
produces them, reproducibly.

## Methodology

The benchmark isolates the **matching algorithm**, which is the only thing that
actually differs between these tools in practice:

1. **Signal collection is held constant.** A seeded PRNG generates a population
   of distinct synthetic entities using Scent's real signal taxonomy
   (`docs/signals.md`), so the engine's prefix-based weighting applies exactly
   as in production. Every matcher sees the identical signal vectors.

2. **Each entity "returns"** once per drift scenario (`src/signals.ts`), which
   mutates the specific signals that scenario changes (e.g. a browser update
   regenerates the canvas/WebGL/audio hashes; a VPN shifts timezone + network).

3. **Each matcher decides "same entity?"** (`src/matchers.ts`):
   - **FingerprintJS (OSS)** and **ThumbmarkJS** are modelled as a deterministic
     hash over their documented component set. They re-identify a visitor **iff
     that hash is byte-for-byte identical** — the definitional behaviour of a
     fingerprint ID. ThumbmarkJS uses a stability-tuned subset (it drops screen
     geometry, WebGL and plugins); FingerprintJS hashes a broader set.
   - **Scent** runs the **real** `@tindalabs/scent-engine`: `weightedJaccard` →
     `scoreToIdentityContinuity`, linking at continuity ≥ `probable` (score ≥
     0.60), with the engine-default `toleratedMismatches: 1`. No reimplementation.

4. **Two metrics:**
   - **Recall** — of drifted return visits, the share correctly re-linked to the
     original entity. Reported per scenario and as a prevalence-weighted overall.
   - **False-merge rate** — of random pairs of *distinct* entities, the share a
     matcher wrongly links. This is the honest cost of drift tolerance; a
     benchmark that only reported recall would be marketing, not measurement.

## Limits & honesty

- The deterministic libraries are modelled by their **matching strategy** (exact
  hash equality over a component set), not executed in a browser. This is faithful
  because re-identification in those libraries *is* hash equality — but it means
  the numbers characterise the **algorithmic** difference, with signal collection
  held identical, not end-to-end library behaviour including their own collectors.
- The population and the per-scenario drift prevalences are synthetic and
  assumption-driven. **The robust takeaway is the relative ranking and the shape
  of the failure modes** (deterministic hashing collapses to ~0% on any hashed-
  component change; Scent degrades gracefully), not the exact percentages.
- The component subsets attributed to FingerprintJS / ThumbmarkJS reflect their
  publicly documented approaches; adjust them in `src/matchers.ts` and re-run.

Everything is deterministic from the seed in `src/run.ts`, so anyone can
reproduce or challenge the result by editing the assumptions and re-running.
