# Scent — Product Roadmap

**Vision:** An open-source probabilistic identity continuity platform for hostile and unstable environments. Developer-first, self-hostable, explainable by design. The identity layer that composes with your existing observability stack.

**Core narrative:** "Still probably the same entity — even after they cleared cookies, switched browsers, and turned on a VPN."

---

## Architecture overview

```
@tindalabs/scent-sdk          (browser)
  └── Signal collection
  └── Multi-storage persistence
  └── Anti-tamper heuristics
  └── OTel traceparent bridge    ← composes with @tindalabs/blindspot

@tindalabs/scent-server       (Node.js / Docker)
  └── Event ingestion API
  └── Identity Engine (probabilistic matching)
  └── Persistence Layer (resurrection strategies)
  └── Risk Engine (anomaly scoring)
  └── REST query API

@tindalabs/scent-observatory  (web UI)
  └── Identity timelines
  └── Drift visualization
  └── Signal explainability
  └── Risk dashboards
```

---

## Phase 0 — Foundation
**Goal:** Monorepo up, CI green, architecture decisions locked.
**Duration:** ~2 weeks
**Owner:** Both collaborators

### Tasks

- [x] Initialize Turborepo monorepo at `tindalabs/scent` (reuse blindspot-ux monorepo structure as reference)
- [x] Define package layout:
  - `packages/sdk` → `@tindalabs/scent-sdk`
  - `packages/engine` → `@tindalabs/scent-engine`
  - `packages/server` → `@tindalabs/scent-server`
  - `apps/observatory` → Observatory UI
  - `apps/demo` → local demo app
- [x] TypeScript 5.x strict config shared across packages
- [x] ESLint + Prettier baseline (copy from content-security-toolkit)
- [x] Vitest for unit tests, Playwright for SDK integration tests
- [x] GitHub Actions CI: lint + test on every PR
- [x] Docker Compose dev stack:
  - PostgreSQL (identity graph + drift history)
  - Redis (session cache + rate limiting)
  - OTel Collector (for blindspot-ux bridge testing)
- [x] Define and document the core data model:
  - `ScentIdentity` — the persistent entity record
  - `ScentSnapshot` — a point-in-time signal collection
  - `ScentDrift` — a delta between two snapshots
  - `ScentRisk` — a risk assessment record
- [x] ADR (Architecture Decision Records) folder — log key decisions as you make them

### Deliverable
A runnable monorepo where `pnpm dev` starts the demo app and Docker stack.

---

## Phase 1 — Client SDK: Signal Collection + Persistence
**Goal:** `scent.observe()` works in a real browser and survives storage destruction.
**Duration:** ~3 weeks
**Owner:** Frontend-leaning collaborator (leverage content-security-toolkit patterns)

### Signal collection module

- [x] Canvas fingerprint (2D context + WebGL renderer string)
- [x] Audio context fingerprint (OfflineAudioContext oscillator hash)
- [x] Font enumeration (canvas text measurement, NOT Flash)
- [x] Screen geometry (resolution, devicePixelRatio, colorDepth)
- [x] Timezone + locale (Intl API)
- [x] Hardware concurrency + device memory (navigator APIs)
- [x] Platform / user agent parsed tokens (not raw UA string)
- [x] Touch support + pointer precision
- [x] Connection type (NetworkInformation API, graceful degradation)
- [x] Installed plugins / MIME types (where available)
- [x] CSS media features (prefers-color-scheme, prefers-reduced-motion)
- [x] WebRTC local IP leak (opt-in — `options.signals.webrtc: true`) — surfaces `webrtc.local_ips` and `webrtc.public_ip` via RTCPeerConnection STUN; reveals real IP behind VPN for same-device correlation
- [x] Private browsing / storage restriction detection — `storage.restricted` boolean; heuristic: Safari private throws on localStorage write; Chrome/Firefox use Storage Manager quota threshold
- [ ] Battery API (opt-in, highly invasive, platform-restricted — low priority)

**Anti-tamper signals (port from content-security-toolkit):**
- [x] WebDriver / Selenium detection (navigator.webdriver, CDP artifacts)
- [x] Headless browser heuristics (missing plugins, inconsistent screen sizes)
- [x] Patched API detection (compare native toString() vs. implemented behavior)
- [x] DevTools open detection (timing-based, as a risk signal — not to block)
- [x] Entropy spoofing detection (canvas returns identical noise — too clean)

### Persistence module

- [x] Identity token storage across all available layers simultaneously:
  - `localStorage` (primary)
  - `sessionStorage` (fallback for same-session recovery)
  - `IndexedDB` (large payload, survives some clear-data events)
  - First-party cookie (server-issued, `HttpOnly`-optional, configurable)
  - ETag-assisted continuity (server responds with identity ETag, SDK sends If-None-Match)
  - Cache Storage API (service worker optional, marked as opt-in)
- [x] Resurrection strategy: on observe(), attempt recovery from each layer in priority order
- [x] Storage health check: detect which layers are available in this browser session
- [x] Configurable `PersistencePolicy`:

```ts
scent.init({
  persistence: "balanced", // "conservative" | "balanced" | "aggressive" | "forensic"
  signals: {
    webrtc: false,    // opt-in invasive signals
    battery: false,
  }
})
```

### SDK public API

```ts
const scent = await sdk.observe()

// Identity
scent.identity.id           // string — the persistent scent ID
scent.identity.confidence   // 0–1 float
scent.identity.isNew        // boolean — first observation
scent.identity.continuity   // "confirmed" | "probable" | "uncertain" | "unknown"

// Drift
scent.drift.detected        // boolean
scent.drift.delta           // changed signals since last snapshot
scent.drift.entropy         // float — magnitude of change

// Risk
scent.risk.score            // 0–1 float
scent.risk.flags            // string[] — e.g. ["automation_suspected", "vpn_detected"]

// Events
scent.on('drift', handler)
scent.on('risk_elevated', handler)
scent.on('identity_resolved', handler)
```

- [x] Event emitter (`scent.on('drift', callback)`) — real-time signals for login flow integration
- [x] `scent.snapshot()` — capture current signal state without resolving identity
- [x] `scent.flush()` — force send buffered events to server
- [x] Framework adapters: React hook (`useScent`), Vue composable (`useScent`)
- [x] SDK is tree-shakeable; signal collectors are individually importable

### Deliverable
`@tindalabs/scent-sdk` published to npm (or local registry). Demo app shows `observe()` result with confidence score. Survives localStorage.clear() and returns `isNew: false` via ETag recovery.

---

## Phase 2 — Identity Engine: Probabilistic Matching
**Goal:** Server-side engine that resolves whether two snapshots are the "same entity" with a calibrated confidence score.
**Duration:** ~6–8 weeks (this is the hard phase)
**Owner:** Both collaborators — math-heavy, needs review

### Data ingestion

- [x] Event ingestion REST endpoint: `POST /v1/events` (accepts SDK snapshot payload)
- [x] Payload schema validation (Zod)
- [x] Idempotent event deduplication (event UUID + timestamp)
- [x] Rate limiting per project API key (Redis-backed)
- [x] Project isolation — all data scoped to an API key / tenant

### Signal weighting model

- [x] Assign base weight to each signal by stability class:
  - **Highly stable** (weight 0.8–1.0): Canvas hash, WebGL renderer, audio fingerprint, hardware concurrency, font list
  - **Moderately stable** (weight 0.4–0.7): Screen resolution, timezone, platform, connection type
  - **Volatile** (weight 0.1–0.3): IP, user agent version, plugin list, battery
- [x] Time-decay function: signal weights decay toward volatile as time between observations grows
- [ ] Configurable weight overrides per project (enterprise feature — deferred to Phase 7)

### Probabilistic matching engine

- [x] SimHash-based approximate nearest neighbor search for candidate retrieval
- [x] Jaccard similarity scoring on signal token sets
- [x] Weighted signal comparison: per-signal match/mismatch/absent scoring
- [x] Drift tolerance thresholds: allow N signals to have changed without reducing confidence below threshold
- [x] Confidence score normalization: output a calibrated 0–1 probability (not a raw similarity score)
- [x] Identity cluster linking: when two previously-distinct identities are resolved as the same entity, merge their history
- [x] Candidate deduplication: prevent single observation from matching multiple existing identities above threshold

### Drift engine

- [x] Per-observation snapshot diff: which signals changed, which are new, which disappeared
- [x] Entropy magnitude calculation: weighted sum of signal change distances
- [x] Drift classification:
  - `minor` — 1–2 volatile signals changed (normal browsing)
  - `moderate` — stable signal changed (browser update, new device profile)
  - `significant` — multiple stable signals changed simultaneously (VPN + browser update + font change)
  - `suspicious` — drift pattern matches known anti-fingerprinting or automation signatures
- [x] Drift history stored per identity: full timeline of snapshots and deltas
- [x] Signal decay: if a signal is absent for N consecutive observations, reduce its weight in that identity's profile

### Identity persistence (server-side)

- [x] PostgreSQL schema:
  - `identities` table (scent ID, first seen, last seen, confidence band, risk band)
  - `snapshots` table (observation payload, signal hash, timestamp, identity FK)
  - `drifts` table (delta payload, entropy score, classification, before/after snapshot FKs)
  - `clusters` table (linked identity groups for coordinated behavior)
- [x] Identity resolution query: O(log n) candidate lookup via SimHash index
- [x] Merge history: audit trail when identities are clustered

### REST query API

- [x] `GET /v1/identity/:id` — full identity record with confidence + risk + last snapshot
- [x] `GET /v1/identity/:id/timeline` — ordered drift history
- [x] `GET /v1/identity/:id/signals` — current signal profile with explainability breakdown
- [x] `POST /v1/resolve` — submit a snapshot, get back identity + confidence without persisting (useful for login flow integration)

### Deliverable
`POST /v1/events` accepts a snapshot, stores it, and resolves it against existing identities. `GET /v1/identity/:id/signals` returns which signals matched and why. Demo app shows live confidence score updating across sessions.

---

## Phase 3 — Risk Engine: Anomaly Scoring
**Goal:** Scent flags suspicious identity behavior — not just "who is this" but "is this normal."
**Duration:** ~3–4 weeks
**Owner:** Backend-leaning collaborator (Ironchip domain knowledge applies directly)

### Heuristic anomaly detectors

- [x] **Impossible transition detector**: geographic or network IP jump that exceeds plausible travel speed
- [x] **Entropy instability detector**: identity whose signal profile changes dramatically on every observation (anti-fingerprinting tool signature)
- [x] **Automation confidence**: combine SDK-side anti-tamper signals into a server-side automation score
- [x] **Storage amnesia pattern**: identity that keeps appearing as "new" from the same device signals (aggressive cookie clearing, private mode cycling)
- [x] **Rapid re-registration pattern**: N new identities from the same device within a time window
- [x] **Coordinated behavior detector**: cluster of identities with identical or near-identical stable signals but different volatile signals — likely the same operator with identity rotation

### Risk scoring model

- [x] Composite risk score: weighted combination of active anomaly detector outputs
- [x] Risk band classification: `low` / `medium` / `high` / `critical`
- [x] Per-flag explanations: each risk flag has a human-readable reason string
- [x] Risk score included in `POST /v1/resolve` response for inline login flow use
- [x] Risk history per identity: track score evolution over time

### Alerting hooks (for SaaS tier)

- [x] Webhook delivery on `risk_elevated` events (configurable threshold)
- [x] Payload includes identity ID, risk score, active flags, and triggering snapshot diff

### Deliverable
`POST /v1/resolve` returns a risk score with flags. Demo app simulates a credential-stuffing pattern (5 logins, rotating emails, same device) and shows all flagged as a coordinated cluster.

---

## Phase 4 — Observatory UI
**Goal:** A UI that a non-technical founder can read to understand their fraud profile.
**Duration:** ~4–5 weeks
**Owner:** Frontend-leaning collaborator

### Identity explorer

- [x] Identity list view: searchable table of all known identities, sortable by confidence / risk / last seen
- [x] Identity detail page:
  - Confidence score with trend sparkline
  - Risk score with active flags
  - Current signal profile (table: signal name, value, stability class, last changed)
  - Signal explainability panel: "Matched: 11/14 stable signals. Mismatched: canvas hash (minor drift). Absent: battery API."
- [x] Drift timeline: chronological list of snapshots with delta highlights

### Drift visualization

- [x] Per-identity drift chart: x = time, y = entropy magnitude, color = drift classification
- [x] Signal stability heatmap: which signals are most volatile for this identity over time

### Coordinated behavior view

- [x] Cluster detail: all identities in a suspected coordination cluster, with shared signal breakdown
- [x] "Why are these linked?" panel: explicit signal overlap explanation

### Project dashboard

- [x] Summary metrics: total identities, new today, high-risk count, average confidence
- [x] Risk distribution histogram
- [x] Drift rate trend (are more identities drifting this week vs. last?)

### Tech stack for Observatory

- [x] React + Vite (consistent with blindspot-ux adapter pattern)
- [x] Recharts or Tremor for data visualization
- [x] shadcn/ui for component library (minimal, unstyled, accessible)
- [x] TanStack Query for data fetching

### Deliverable
Observatory running at `localhost:4000` (Docker Compose). Shows live identity data from the demo app. Drift timeline and signal explainability panels functional.

---

## Phase 5 — OpenTelemetry Bridge
**Goal:** Scent events attach to an existing OTel trace. Companies using blindspot-ux get identity context on every span automatically.
**Duration:** ~2 weeks
**Owner:** Both collaborators

### Integration design

- [x] SDK reads `traceparent` from the current page context (set by `@tindalabs/blindspot`)
- [x] Scent snapshot payload includes `traceparent` if present
- [x] Server stores `traceparent` on the snapshot record
- [x] `GET /v1/identity/:id/timeline` includes `traceparent` references — each drift event links to the OTel trace that triggered it
- [x] Optional: Scent server emits its own OTel spans (identity resolution latency, risk scoring time) to the configured OTLP endpoint

### blindspot-ux integration package

- [x] New package: `@tindalabs/scent-otel` (or `@tindalabs/scent-bridge`)
- [x] Adds `scent.identity.id` and `scent.identity.confidence` as span attributes on every `@tindalabs/blindspot` span
- [x] Zero-config when both SDKs are present: auto-detects `@tindalabs/blindspot` context

### Deliverable
A single demo app running both `@tindalabs/blindspot` and `@tindalabs/scent-sdk`. The Grafana Tempo trace for a login event includes `scent.identity.id`, `scent.identity.confidence`, and `scent.risk.score` as span attributes.

---

## Phase 6 — Self-Hosting + OSS Launch
**Goal:** Anyone can run Scent in production from a single `docker compose up`. OSS launch generates early adopters.
**Duration:** ~3 weeks
**Owner:** Both collaborators

### Self-hosting

- [x] Production-grade `docker-compose.yml`:
  - scent-server
  - scent-observatory
  - PostgreSQL with init migrations
  - Redis
  - Optional: OTel Collector sidecar
- [x] Environment variable configuration reference (API keys, DB URL, persistence policy defaults, webhook endpoints)
- [x] One-command database migration: `scent migrate`
- [x] Health check endpoint: `GET /health`
- [ ] Helm chart (stretch goal — community contribution friendly)

### Documentation

- [x] `README.md`: 5-minute quickstart (install SDK, get first identity resolution)
- [x] `docs/concepts.md`: probabilistic identity, drift, confidence, persistence policies — explain the mental model
- [x] `docs/signals.md`: full list of collected signals, stability class, legal basis notes for GDPR
- [x] `docs/persistence-policies.md`: what each policy collects and why — this is your legal/DPO document
- [x] `docs/openapi.yaml`: full REST API reference (OpenAPI 3)
- [x] `docs/integrations/blindspot-ux.md`: OTel bridge setup guide
- [x] Migration guide: "Coming from FingerprintJS"

### GTM

- [ ] GitHub repo public with clean README and demo GIF
- [ ] `tindalabs.dev` landing page (single page: what it is, why it's different, quickstart)
- [ ] Hacker News Show HN post
- [ ] Dev.to / Medium article: "Why browser fingerprinting alone isn't enough — and what we built instead"
- [ ] Reach out directly to 10–15 mid-market SaaS founders/CTOs who are vocal about fraud on Twitter/LinkedIn

---

## Phase 7 — Cloud SaaS + Monetization
**Goal:** Hosted version live, first paying customer, pricing validated.
**Duration:** ~4 weeks (after Phase 6 traction)
**Owner:** Both collaborators

### Cloud infrastructure

- [x] Multi-tenant architecture: all data scoped by project (every table FK'd to `projects` with `ON DELETE CASCADE`; API key → project_id resolved in auth). API keys are hashed at rest (SHA-256).
- [ ] Usage metering: count identity resolutions per billing period
- [x] API key management UI (create, rotate, revoke) — Observatory **API Keys** page behind multi-user admin auth (bcrypt, server-side sessions, CSRF, per-IP rate limit); rotate/revoke bust the Redis auth cache immediately
- [ ] Billing integration: Stripe (usage-based, metered billing)

### Pricing tiers

| Tier | Price | Limits | Features |
|---|---|---|---|
| Free | $0 | 10k resolutions/month | SDK + API + self-hosting |
| Pro | $249/month | 250k resolutions | Cloud hosting + Observatory UI + email support |
| Enterprise | Custom | Unlimited | SSO + audit logs + data residency + SLA + Persistence Policy compliance docs |

### Compliance features (Enterprise gate)

- [ ] Persistence Policy compliance report: auto-generated document listing all signals collected under current policy
- [ ] Data export: full identity + snapshot + drift history export (GDPR Article 20)
- [ ] Data deletion: `DELETE /v1/identity/:id` with cascading history deletion (GDPR Article 17)
- [ ] Audit log: who queried what identity, when, from which IP

---

## Milestone summary

| Milestone | Phase | Target |
|---|---|---|
| Monorepo + dev stack | 0 | Week 2 |
| `scent.observe()` works in browser | 1 | Week 5 |
| Server resolves identity with confidence score | 2 | Week 13 |
| Risk engine + coordinated behavior detection | 3 | Week 17 |
| Observatory UI functional | 4 | Week 22 |
| OTel bridge + blindspot-ux composability | 5 | Week 24 |
| OSS launch (self-hosting + docs) | 6 | Week 27 |
| First paying customer | 7 | Week 31 |

---

## Phase 8 — Account Linking & Entity Graph
**Goal:** Connect anonymous Scent identities to authenticated account IDs, enabling "these 5 free trial accounts share a device" queries and closing the loop from probabilistic identity to actionable fraud detection.
**Duration:** ~2–3 weeks
**Owner:** Both collaborators

### Why this matters

Without account linking, Scent produces anonymous identity continuity signals with no connection to the application's user records. The ICP's job-to-be-done #1 is "I need to know if the person creating their 5th free trial account is the same device as the previous four" — this phase makes that answerable.

### SDK

- [x] `scent.identify(accountId: string): Promise<void>` — links the current Scent identity to an application-level account ID; POST to `/v1/identity/:id/link`
- [x] `identify()` is a no-op if no identity has been resolved yet in this session

### Server

- [x] Migration `004_account_links.sql` — `identity_account_links` table: `(id, project_id, identity_id, account_id, first_linked_at, link_count)`; unique index on `(project_id, identity_id, account_id)`
- [x] `POST /v1/identity/:id/link` — body: `{ accountId }` — upserts a link record; returns 200 with link count
- [x] `GET /v1/identity/:id/accounts` — returns all account IDs ever linked to this Scent identity, with first-linked timestamp and link count
- [x] `GET /v1/account/:accountId/identities` — returns all Scent identities ever linked to this account ID, with confidence and risk summary — this is the fraud-detection query
- [x] Risk engine integration: flag `coordinated_accounts` when N ≥ 3 distinct accounts link to the same identity within a rolling 30-day window

### Observatory

- [x] Account links panel on identity detail page: shows all account IDs linked to this identity
- [x] "Account clusters" view: sorted table of account IDs sharing a Scent identity, with shared-device count and risk band — the primary fraud investigation surface

### Deliverable
`scent.identify(userId)` called at login. Observatory shows all accounts that share a device. Risk engine flags coordinated registrations. `GET /v1/account/:id/identities` usable for inline signup-flow risk checks.

---

## What is explicitly out of scope (MVP)

These are not in any phase above. Revisit after first paying customer.

- Session replay
- ML-based models (start heuristic, add ML in v2)
- Cross-device linking (web-first, device-second)
- Mobile native SDKs (iOS, Android)
- Browser exploit tricks / CNAME cloaking / DNS rebinding
- Email / phone intelligence signals
- Real-time streaming API (webhooks cover the MVP use case)

---

## Advisory Backlog — 2026-05-19

Findings from a full C-level assessment (CTO / CPO / COO / CMO / CFO + competitive research).
Overall score: **6.0/10** — the code and product thinking deserve an 8; the distribution and launch execution score a 2.
Full report: `c-level/reports/scent_2026-05-19.md`

### Immediate (this week)

- [x] Add `LICENSE` file (MIT) to repo root — blocks every enterprise procurement tool and npm publish
- [x] Add `pnpm build` step to `.github/workflows/ci.yml` — a broken TypeScript compilation currently passes CI
- [x] Pin `otel/opentelemetry-collector-contrib`, `grafana/tempo`, `grafana/grafana` to specific versions in `docker-compose.yml` (postgres/redis are already pinned; be consistent)
- [x] Add `SECURITY.md` with maintainer contact and 90-day responsible disclosure policy
- [x] Add `.github/dependabot.yml` for monthly npm dependency updates
- [x] Add `pnpm audit --audit-level=high` to CI pipeline

### Next Sprint (1–4 weeks)

- [x] Implement Phase 8: `scent.identify(accountId)` + `POST /v1/identity/:id/link` + Observatory account clusters view — this is job-to-be-done #1 for the primary ICP
- [x] Add compound PostgreSQL index on `snapshots(project_id, identity_id, timestamp DESC)` (migration `005`) — and the O(n) scan itself was eliminated: SimHash blocking index (migration `006`, `bit_count` Hamming prefilter) replaced the per-request linear scan, and async ingest (BullMQ queue + worker) moved resolution off the request path entirely
- [x] Cache project API key lookups in Redis (`middleware/auth.ts`, keyed on the SHA-256 hash) — eliminates the per-request DB round-trip on every `/v1/*` route
- [x] Server / probabilistic-core test coverage — ~88% statements (events resolution/dedup/cluster-linking, `/v1/resolve`, read routes, all risk detectors); see `pnpm --filter @tindalabs/scent-server test:coverage`
- [ ] SDK test coverage still pending: `sdk/persistence/*` and `sdk/collectors/*` (server core is done above)
- [x] Add `pino` structured JSON logging to Express server (`logger.ts`)
- [x] Add `CHANGELOG.md` and tag `0.1.0`
- [x] Add `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Add `# DO NOT USE IN PRODUCTION without configuring CORS` comment to `infra/otel-collector.yaml` if applicable

### Strategic (1–3 months)

- [~] **Simultaneous launch**: GitHub repo is public and npm packages are published (`scent-sdk`/`-engine`/`-otel` @ `0.1.0`, trusted publishing). **Show HN post still pending** — the launch-day momentum play is not yet fired.
- [ ] Launch `tindalabs.dev` landing page — `docs/tindalabs-landing-page-spec.md` has all the copy; HN traffic needs somewhere to land
- [ ] Write and publish "Why FingerprintJS free tier isn't enough — and what we built instead" blog post on Dev.to and Medium (the migration guide is already written; this is the SEO play)
- [ ] Implement usage metering (`resolution_count` increment per project per billing period) — the revenue meter; unblocks Phase 7 Stripe integration
- [~] Implement Phase 7 SaaS: **API key management UI is done** (admin auth — multi-user accounts, sessions, CSRF — + Observatory create/rotate/revoke); Stripe usage-based billing + billing dashboard still pending (gated on usage metering above)
- [x] Publish accuracy benchmarks comparing Scent vs. FingerprintJS OSS vs. ThumbmarkJS ✅ — added `bench/` (`@tindalabs/scent-bench`, run via `pnpm bench`): a reproducible, seeded harness that holds signal *collection* constant and varies only the matcher, driving the **real** `@tindalabs/scent-engine`. Models the deterministic libs faithfully (re-identify iff the hashed component set is byte-for-byte identical). Headline ([`bench/RESULTS.md`](bench/RESULTS.md)): **weighted recall FingerprintJS 45% / ThumbmarkJS 55% / Scent 100%** under drift; deterministic IDs collapse to 0% the instant any hashed component changes (browser update, anti-fingerprinting, VPN/timezone, new monitor — Thumbmark survives only the monitor case by dropping screen geometry). Crucially it also reports Scent's **confidence gradient** (mean 1.00→0.80; "confirmed" share drops to 57.9% on browser updates, 15.8% on anti-fingerprinting) and a **false-merge counter-metric** — so it reads as measurement, not a brochure. Methodology + limits documented in `bench/README.md`.
- [x] Publish `tindalabs/scent-server` Docker image so self-hosters can `docker pull` — auto-published on every main push to **both GHCR (`ghcr.io/tindalabs/scent-server`) and Docker Hub (`tindalabs/scent-server`)** via `.github/workflows/publish-docker.yml`
- [ ] Reach out to 10–15 mid-market SaaS founders/CTOs who post publicly about fraud on Twitter/LinkedIn (primary community seeding)
- [ ] **Calibrate risk confidences against labeled outcomes** — every detector's `confidence` and the per-flag weights (`risk/detectors/*`, `engine/risk/automation.ts`) are currently *expert-tuned constants*, not fit to data. The combiner is principled (noisy-OR in `engine/risk/scorer.ts`); the inputs are guesses. Once there's a labeled outcome stream (customer fraud/chargeback/ban feedback, or manual review labels), fit per-detector confidences and recalibrate the band thresholds (e.g. isotonic/Platt scaling) so a "0.7" means ~70% empirical fraud probability. Needs labeled data → post-launch. Until then, treat scores as ordinal, not calibrated probabilities. Add reliability-diagram tracking to measure calibration drift over time.
- [ ] **Trusted devices & account-takeover (identity-graph / trust workstream)** — the inverse of the fraud detectors, and arguably the higher-value commercial angle. Builds on Phase 8 account linking (`identity_account_links`, `identify()`), which today only records a link on an explicit `identify()` call with no confidence or lifecycle. Three pieces:
  - **Trusted-device recognition** — a confidence-scored, decaying device↔account relationship so customers can *reduce* friction (skip step-up/2FA) when a returning login comes from a device with established lineage for that account. The friction-reduction story, not just fraud-blocking.
  - **Account-takeover (ATO) detector** — fire when a login to an established account comes from a device whose fingerprint shares *no* lineage with any of the account's known devices (the flip side of the same graph). New detector + surfaced flag.
  - **Legitimate multi-device clarity** — the asymmetry is the product: *one account → many devices* is normal (laptop/phone/work); *one device → many accounts* is suspicious (`/v1/accounts/clusters`). Make this explicit in the Observatory (per-account device list vs. shared-device fraud cluster).
  Distinct from the current fraud-leaning detectors; scope as its own workstream once past launch. Shares the labeled-outcome dependency with calibration above (trust/ATO thresholds want real login-outcome labels).

### Watch List

- **O(n) candidate scan at scale** — ✅ RESOLVED: SimHash blocking index (`bit_count` Hamming prefilter, migration `006`) + async ingest worker removed the per-request linear scan. Still worth a Grafana alert on `scent.identity_resolution` span duration > 500ms as a regression guard.
- **FingerprintJS Pro pricing changes** — Fingerprint.com is under competitive pressure from ThumbmarkJS and browser anti-fingerprinting; monitor their pricing page for moves below $50/month
- **ITP/Chrome Privacy Sandbox velocity** — Apple ITP and Chrome Privacy Sandbox updates degrade individual signal stability; monitor `drift.classification: 'suspicious'` rate spike after major Safari/Chrome releases as a health signal
- **2-person bus factor** — the probabilistic core is complex; growing community with CONTRIBUTING + `good-first-issue` tags is the mitigation

### Deferred / follow-ups (2026-06-13 hardening sprint)

Surfaced and consciously deferred while hardening the server for self-hosted launch
(this sprint shipped: async ingest, SimHash blocking, hashed API keys, admin auth +
key-management UI, Hetzner deploy stack + BSL-1.1 server license, dual-registry Docker
images, OpenAPI spec, ~88% server coverage, GeoIP impossible-travel + anonymizer/datacenter
signal, SimHash-Hamming coordinated-fraud detectors).

- [ ] **Postgres outbox for ingest durability** — at-least-once currently relies on Redis AOF + the `event_id` dedupe in the worker. An outbox table is the more durable alternative if Redis persistence proves insufficient.
- [x] **Per-project data viewing via the admin session** — the `/v1` read routes now accept an admin session + `X-Project-Id` (GET only) alongside the project key (`requireProjectRead`), and the Observatory has a project switcher that scopes every data page. The build-time `VITE_API_KEY` is gone. Ingest/resolve stay strictly key-gated.
- **Admin RBAC + account management** (two-level RBAC + invite links + TOTP 2FA, staged across 3 PRs):
  - [x] **PR1 — RBAC core**: `admin_users.role` (owner/member) + `project_members(user_id, project_id, role)` (migration 009); `requireProjectRead` and the `/admin/projects` routes enforce it (owners = superusers; members reach only granted projects; project-create/delete owner-only, rotate = manage). Existing CLI-created admins are owners.
  - [x] **PR2 — account-management UI**: owner-only Users page — invite via copy-paste link (opaque one-time token, no SMTP; public `/accept-invite` auto-logs-in), list/role-change/soft-deactivate (deactivation revokes sessions + blocks login), per-project membership grants, self-service password change. Lockout guards: can't demote/deactivate yourself or the last active owner.
  - [x] **PR3 — 2FA**: TOTP (otplib) + hashed one-time recovery codes; secret AES-256-GCM-encrypted at rest via `SCENT_SECRET_KEY` (unset = enrollment disabled, server still runs); login challenge (code or recovery code); owner-set org-wide "require 2FA" toggle that funnels un-enrolled admins into setup (login still issues a session so there's no lockout). WebAuthn/passkeys = future.
- **CodeQL exclusions** (`.github/codeql/codeql-config.yml`): `js/missing-rate-limiting` and `js/missing-token-validation` are excluded — they don't recognize the custom Redis limiter or double-submit CSRF (and already mis-flag the existing `/v1` limiter). Revisit if we adopt recognized libraries.
