# GDPR & consent integration guide

Scent is built **privacy-by-default**: the SDK collects, persists, and transmits
**nothing** until consent is granted. It *enforces* consent but never renders a banner —
because in almost every deployment **you are the data controller** and you already own
the consent experience. This guide shows how to wire Scent into it. The architecture
rationale is recorded in [ADR-0004](../adr/0004-consent-and-data-lifecycle.md).

## Who is responsible for what

| | Role | Owns |
|---|---|---|
| **You** (the site embedding Scent) | **Data controller** | The privacy notice, the lawful basis, the consent prompt (your CMP), and the user relationship. |
| **Scent** | Processor (hosted) / tool (self-host) | Enforcing the gate you configure, recording the basis you declare, and honouring deletion. |

Consequence: **the SDK ships no consent UI.** It reads consent from your existing CMP
(or an explicit call) and gates everything on it.

## The two gates (don't conflate them)

1. **ePrivacy Art. 5(3)** — reading/writing on the device (the fingerprint signals *and*
   Scent's `localStorage`/`IndexedDB`/cookie persistence) needs **prior opt-in consent**
   *unless* it is "strictly necessary for a service the user requested."
2. **GDPR** — processing the resulting personal data (fingerprint + IP) needs a **lawful
   basis**: consent, or **legitimate interest** (fraud prevention is a recognised LI).

A login-security / account-takeover use case the *user themselves* initiated has a
credible "strictly necessary" argument under 5(3); analytics-style scoring does not.
**You** decide which applies and declare it — Scent records it, it does not adjudicate.

## Wiring consent

Pick the mode that matches your CMP. Collection stays off until the resolver reports
granted (fail-closed).

```ts
import { init } from '@tindalabs/scent-sdk';

// 1) Manual — you flip it after your own banner resolves (default mode).
const scent = init({ apiKey });
scent.setConsent(true);   // ...and scent.setConsent(false) to revoke

// 2) Callback — Scent asks your CMP on each observe() (sync or async).
init({ apiKey, consent: { mode: 'callback', resolve: () => myCmp.hasConsent('analytics') } });

// 3) IAB TCF v2 — reads window.__tcfapi (Purpose 1: store/access on device).
init({ apiKey, consent: { mode: 'tcf' } });

// 4) Google Consent Mode — reads analytics_storage / ad_storage from the dataLayer.
init({ apiKey, consent: { mode: 'gcm' } });
```

### Declare the lawful basis

```ts
init({
  apiKey,
  basis: 'legitimate_interest',   // 'consent' (default) | 'legitimate_interest' | 'strictly_necessary'
  consentVersion: 'privacy-policy-2026-01',
});
```

`basis`, `consentVersion`, and the grant time are attached to every snapshot and stored
immutably server-side, so you can demonstrate consent (GDPR Art. 7(1)).

## Data-subject rights

**Client** — `scent.forget()` purges every local storage layer and returns the cleared
identity id (use it to also delete server-side):

```ts
const id = await scent.forget();
if (id) await fetch(`${api}/v1/identity/${id}`, { method: 'DELETE', headers: { 'X-Api-Key': key } });
```

**Server**
- `DELETE /v1/identity/:id` — erasure (Art. 17); snapshots/drifts/risk/links cascade. **Key-gated.**
- `GET /v1/identity/:id/export` — portability (Art. 20); the full bundle as JSON.

## Data minimisation (defaults)

- **Client IP is network-truncated at rest** (`/24` IPv4, `/48` IPv6) — still city-accurate
  for impossible-travel, with the host bits dropped. Set the project's `store_full_ip`
  only with a documented basis.
- **Retention**: set a project's `retention_days` and a daily sweep erases identities idle
  longer than that (cascading). Null = keep indefinitely.

## DPA (template stub)

For the hosted tier, Tindalabs acts as your **processor**. A Data Processing Agreement
should cover: subject-matter & duration; nature/purpose (probabilistic identity & fraud
signals); categories of data (device signals, truncated IP, linked account ids); sub-
processors (the hosting provider); security measures; deletion on termination; and
audit rights. *(Contact for the current DPA; this is not legal advice.)*
