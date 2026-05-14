# ADR-0002: Persistence Policies as first-class configuration

**Status:** Accepted
**Date:** 2026-05-14

## Context

Aggressive identity persistence (multi-layer storage, ETag continuity, service worker caching) is technically effective but creates legal and ethical exposure. GDPR Article 5 and the ePrivacy Directive regulate persistent cross-session identifiers. Enterprise security and legal teams need to understand and control exactly what is being collected and persisted on their users' devices.

The naive approach — hardcode aggressive persistence and disclaim it as the developer's responsibility — works for individual developers but blocks adoption by any company with a DPO or legal counsel.

## Decision

Expose a **PersistencePolicy** enum as a first-class SDK configuration option:

```ts
scent.init({ persistence: 'balanced' })
```

Policies:

| Policy | Storage layers used | Intended audience |
|---|---|---|
| `conservative` | First-party cookie only (session-scoped) | GDPR-strict, healthcare, finance |
| `balanced` | localStorage + cookie | Default. Most SaaS use cases |
| `aggressive` | All layers: localStorage, sessionStorage, IndexedDB, cookie, ETag | Fraud/security teams needing maximum continuity |
| `forensic` | All layers + service worker cache | Incident response, abuse investigation |

Each policy has a corresponding compliance document (generated automatically for Enterprise tier) that lists exactly which browser APIs are accessed and the legal basis for each under GDPR Article 6.

## Consequences

- The PersistencePolicy must be respected unconditionally by the SDK. There must be no way to silently exceed the declared policy.
- The server must store which policy was active for each snapshot — auditors need to verify that historical data was collected within declared bounds.
- `forensic` mode must require explicit opt-in beyond the default config — it should not be reachable by accident.
- Policy documentation must be kept in sync with implementation. Any new storage layer added to the SDK must be gated behind the appropriate policy level before shipping.
- This is the primary enterprise sales differentiator: "the only identity platform your DPO can configure."
