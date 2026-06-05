# @tindalabs/scent-engine

[![npm version](https://img.shields.io/npm/v/@tindalabs/scent-engine.svg)](https://www.npmjs.com/package/@tindalabs/scent-engine)
[![CI](https://github.com/tindalabs/scent/actions/workflows/ci.yml/badge.svg)](https://github.com/tindalabs/scent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![types](https://img.shields.io/npm/types/@tindalabs/scent-engine.svg)](https://www.npmjs.com/package/@tindalabs/scent-engine)

**The framework-agnostic core of Scent** — signal weighting, SimHash, similarity matching, drift detection, confidence scoring, and risk primitives.

This is the pure-logic layer shared by the SDK and the server. It has no browser or DB dependencies, so you can run the same scoring offline, in tests, or in your own pipeline.

```bash
npm install @tindalabs/scent-engine
```

## What's inside

```ts
import {
  computeSimHash, hammingDistance,        // locality-sensitive signal hashing
  weightedJaccard,                         // drift-tolerant similarity (0–1)
  diffSnapshots,                           // classify drift between two snapshots
  scoreToConfidenceBand,                   // 0–1 → confirmed/probable/uncertain/unknown
  detectAutomation,                        // headless/bot signal detector
  compositeRiskScore, scoreToRiskBand,     // probabilistic-OR risk aggregation
  weightOf,                                // per-signal stability weight
} from '@tindalabs/scent-engine';
```

It also exports the canonical domain types shared across the stack: `ScentIdentity`, `ScentSnapshot`, `ScentDrift`, `RiskFlag`, `SignalMap`, `ConfidenceBand`, `RiskBand`, and more.

## Example

```ts
import { weightedJaccard, scoreToConfidenceBand } from '@tindalabs/scent-engine';

const score = weightedJaccard(previousSignals, currentSignals);
const band = scoreToConfidenceBand(score.confidence);   // "confirmed"
```

---

Part of [Scent](https://github.com/tindalabs/scent). MIT licensed.
