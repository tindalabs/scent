# Scent — Agent Context

## What this project is

An open-source **probabilistic identity continuity platform** for hostile browser environments. Scent tracks whether a returning visitor is "likely the same entity" even after cookie deletion, VPN changes, browser updates, or anti-fingerprinting tools — using a drift-tolerant confidence scoring engine, not deterministic hashes.

Core narrative: *"Persistent probabilistic identity for hostile and unstable environments."*

The generated identifier is called a **scent** (not fingerprint, not visitor ID). The API surface: `scent.observe()` → `scent.identity.confidence`.

## Key documents

- [ICP.md](ICP.md) — Ideal Customer Profile. Primary: mid-market SaaS (50–500 employees, 5k–500k MAU) fighting free tier abuse and account takeover. Read before making product scope decisions.
- [ROADMAP.md](ROADMAP.md) — Phased implementation plan with checkboxes. Source of truth for what's done and what's next.
- [docs/signals.md](docs/signals.md) — Full signal reference: every key produced by every collector, stability class, browser support, and GDPR legal basis notes. Read before modifying collectors or designing the Phase 2 weighting model.
- [docs/adr/](docs/adr/) — Architecture Decision Records for locked decisions (probabilistic matching, persistence policies, OTel bridge).

## Monorepo package layout (target)

```
packages/sdk        → @tindalabs/scent-sdk      (browser, signal collection + persistence)
packages/engine     → @tindalabs/scent-engine    (probabilistic matching, drift, risk)
packages/server     → @tindalabs/scent-server    (Node.js API server)
apps/observatory    → Observatory UI             (React + Vite)
apps/demo           → Local demo app
```

## Sibling projects — reuse patterns from these

Both live in `../` relative to this repo.

### `../content-security-toolkit`
TypeScript browser security library. Reuse:
- DevTools detection heuristics (timing-based, resize)
- WebDriver / Selenium detection patterns
- Patched API detection (`toString()` comparison)
- Extension detection heuristics
- Strategy pattern for modular, independently-toggleable features

### `../blindspot-ux`
OpenTelemetry frontend observability SDK. Reuse:
- **Monorepo structure**: Turborepo + pnpm, `@scope/core` + framework adapters pattern
- **OTel wiring**: how to instrument a browser SDK with spans and attributes
- **Privacy-aware signal collection**: PII redaction before export
- **Docker Compose dev stack**: OTel Collector + Grafana Tempo reference
- **Framework adapter pattern**: React hook / Vue composable wrappers over a framework-agnostic core
- **TypeScript config**: strict tsconfig, shared ESLint rules

The OTel bridge goal: Scent attaches `scent.identity.id` and `scent.identity.confidence` as span attributes on every `@blindspot/web` span via `traceparent`. Same developer persona, composable without coupling.

## Architecture decisions (locked)

- Signal weights are not equal. Signals are classified as **highly stable / moderately stable / volatile** and weighted accordingly. Weights decay over time between observations.
- Probabilistic matching uses **SimHash + Jaccard similarity** on signal token sets, not a hash comparison.
- Identity resolution returns a **calibrated 0–1 confidence score** with a human-readable signal breakdown — explainability is a first-class feature, not a debug tool.
- **Persistence Policies** (`conservative | balanced | aggressive | forensic`) are a first-class config option, not an afterthought. They are the legal/compliance lever for enterprise buyers.
- Server-side components are **PostgreSQL + Redis**. No MongoDB, no DynamoDB.
- Observatory UI is **React + Vite + shadcn/ui + Recharts**.

## Development workflow

### Using the roadmap

1. Open `ROADMAP.md`
2. Find the **current phase**: the lowest-numbered phase that still has unchecked items (`- [ ]`)
3. Take the **first unchecked item** in that phase
4. After completing it, mark it `[x]`
5. Run `/next` to see what follows

Use `/next` to show the next open tasks. Use `/done <task description>` to mark a task complete.

### Commit conventions

- **Atomic commits**: one logical change per commit. Do not bundle unrelated changes.
- **Imperative present tense**: "add canvas fingerprint collector", not "added" or "adds"
- **Message body**: explain WHY, not WHAT. The diff shows what changed; the message explains the reason.
- **No signatures, no co-author footers** on any commit message.
- Examples of good messages:
  ```
  add SimHash-based candidate retrieval to identity engine

  Flat database scans become prohibitive past ~100k identities.
  SimHash gives us O(log n) approximate nearest-neighbor lookup
  at the cost of a small false-negative rate, which is acceptable
  given the confidence scoring layer above it.
  ```
  ```
  scope persistence policy to init config, not per-observe call

  Per-call overrides create audit inconsistencies — a single identity
  could be observed under different policies in the same session,
  making compliance reporting impossible.
  ```

### What not to do

- Do not bundle SDK changes with server changes in one commit unless they are a single atomic API contract change
- Do not create new abstractions beyond what the current phase requires
- Do not add error handling for scenarios the internal architecture guarantees cannot happen
- Do not write comments that describe WHAT the code does — only add one if the WHY is non-obvious
