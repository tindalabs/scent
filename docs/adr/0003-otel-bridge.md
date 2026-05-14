# ADR-0003: OTel traceparent bridge for blindspot-ux composability

**Status:** Accepted
**Date:** 2026-05-14

## Context

Scent and `blindspot-ux` (sibling project at `../blindspot-ux`) target the same developer persona and compose naturally:

- `blindspot-ux` answers "what did this user do?" via OpenTelemetry spans
- `scent` answers "who is this user?" via probabilistic identity

A naive integration would couple the two SDKs directly (Scent imports blindspot-ux, or vice versa). This creates a hard dependency that prevents either from being used independently, and forces joint versioning.

## Decision

Compose via the **W3C `traceparent` header**, which is already emitted by `@blindspot/web` and understood by any OTel-compatible system.

The integration works as follows:

1. `@blindspot/web` injects a `traceparent` into the page context as a meta tag or JS variable.
2. `@irregular/scent-sdk` reads this value (if present) and attaches it to every snapshot payload sent to the server.
3. The server stores `traceparent` on the snapshot record.
4. A separate bridge package (`@irregular/scent-otel`) reads the current Scent observation and sets `scent.identity.id`, `scent.identity.confidence`, and `scent.risk.score` as attributes on the active OTel span.

This means:
- Each OTel trace in Grafana Tempo carries identity context automatically when both SDKs are present.
- Neither SDK has a hard dependency on the other — the bridge is an optional third package.
- Companies using only one product are not penalised with unused code.

## Consequences

- `@irregular/scent-otel` is a Phase 5 deliverable, not part of MVP.
- `traceparent` attachment in the snapshot payload costs zero additional bytes if `@blindspot/web` is not present (the field is simply absent).
- The bridge must be tested with both SDKs simultaneously in the demo app to verify span attribute propagation end-to-end.
- This architecture enables the `irregular.dev` platform story: two independent products that compose without coupling, sharing the same observability backend.
