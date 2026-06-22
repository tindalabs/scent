# Architecture Decision Records

Each ADR documents a significant architectural choice: the context, the decision, and the rationale. Once accepted, an ADR is immutable — if the decision changes, a new ADR supersedes it.

| # | Title | Status |
|---|---|---|
| [0001](0001-probabilistic-matching.md) | Probabilistic matching via SimHash + Jaccard | Accepted |
| [0002](0002-persistence-policies.md) | Persistence Policies as first-class config | Accepted |
| [0003](0003-otel-bridge.md) | OTel traceparent bridge for blindspot-ux composability | Accepted |
| [0004](0004-consent-and-data-lifecycle.md) | Consent is the controller's responsibility; the SDK enforces, never triggers | Accepted |
| [0005](0005-organizations-and-tenancy.md) | Organizations are the tenant boundary; owner is org-scoped, not global | Accepted |
| [0006](0006-observability-sentry.md) | Sentry-led error tracking now; OTel traces/logs to a backend deferred | Accepted |
