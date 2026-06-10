# Scent accuracy benchmark — results

> **Generated artifact.** Run `pnpm bench` to regenerate. Fully deterministic
> (seed `0x5ce7`, 5000 entities, 20000 false-merge pairs). See [`README.md`](./README.md) for methodology and limits.

## What this measures

Identity **continuity** under real-world signal drift. All three matchers see
the **same** synthetic signal vectors (Scent's real taxonomy, `docs/signals.md`)
— the only variable is the matching algorithm. FingerprintJS (OSS) and
ThumbmarkJS hash a fixed component set and re-identify a visitor **iff that hash
is byte-for-byte identical**; Scent runs its real production engine
(`weightedJaccard` → `scoreToIdentityContinuity`).

## Re-identification recall

% of drifted return visits correctly re-linked to the original entity
(deterministic libs: exact-hash match; Scent: continuity ≥ `probable`, score ≥ 0.60).

| Scenario | FingerprintJS (OSS) | ThumbmarkJS | Scent |
| --- | --- | --- | --- |
| Same session (no change) | 100% | 100% | 100% |
| Minor drift (network only) | 100% | 100% | 100% |
| Browser update (canvas/webgl/audio regenerate) | 0% | 0% | 100% |
| VPN / travel (timezone + network change) | 0% | 0% | 100% |
| New monitor (screen geometry change) | 0% | 100% | 100% |
| Anti-fingerprinting (per-load canvas/audio randomization) | 0% | 0% | 100% |
| **Weighted overall** | **45%** | **55%** | **100%** |

## Scent confidence gradient

The single recall number hides what makes Scent different: a **graded,
explainable** confidence, not a yes/no. The deterministic libraries have no
equivalent — they are binary. Below, `probable` (≥0.60) is the link threshold
above; `confirmed` (≥0.85) is the high-trust band. Watch confidence degrade
honestly with drift while continuity is preserved.

| Scenario | Mean confidence | % confirmed (≥0.85) | % probable+ (≥0.60) |
| --- | --- | --- | --- |
| Same session (no change) | 1.00 | 100% | 100% |
| Minor drift (network only) | 0.99 | 100% | 100% |
| Browser update (canvas/webgl/audio regenerate) | 0.87 | 57.9% | 100% |
| VPN / travel (timezone + network change) | 0.97 | 100% | 100% |
| New monitor (screen geometry change) | 0.90 | 88.8% | 100% |
| Anti-fingerprinting (per-load canvas/audio randomization) | 0.80 | 15.8% | 100% |

## False-merge rate

% of random pairs of **distinct** entities a matcher wrongly links. Lower is
better. Deterministic hashes essentially never collide (perfect precision);
Scent trades a small, **quantified** false-merge rate for the recall gains
above. Reporting it is the difference between a benchmark and a brochure.

| Matcher | False-merge rate |
| --- | --- |
| FingerprintJS (OSS) | 0% |
| ThumbmarkJS | 0% |
| Scent | 0% |

## How to read this

- **Deterministic libraries** are perfect on `same_session` / `minor` (the
  changed signals aren't hashed) and **collapse to ~0%** the instant a hashed
  component changes — a browser update, an anti-fingerprinting browser, or (for
  FingerprintJS) a new monitor or VPN-driven timezone shift. ThumbmarkJS survives
  the new monitor only because it drops screen geometry from its hash.
- **Scent** preserves continuity through every one of those because a few changed
  signals do not flip a probabilistic score below threshold — and it reports *how
  sure* it is, degrading confidence gracefully rather than declaring a stranger.
