# ADR-0004: Consent is the controller's responsibility; the SDK enforces, never triggers

**Status:** Accepted
**Date:** 2026-06-16

## Context

Scent collects device signals (canvas, audio, fonts, hardware, …) and persists
identifiers across multiple storage layers. Both acts are regulated:

1. **ePrivacy Directive Art. 5(3)** — reading from or writing to a user's device
   (the fingerprint signals *and* Scent's localStorage/IndexedDB/cookie/ETag
   persistence) requires **prior, informed, opt-in consent** *unless* it is
   "strictly necessary for a service the user explicitly requested." The EDPB's
   Opinion 9/2014 treats device fingerprinting the same as cookies.
2. **GDPR** — processing the resulting personal data (fingerprint + IP) requires a
   lawful basis: consent, or **legitimate interest** (fraud prevention is a
   recognised LI), etc.

Conflating these two gates is the common mistake. A login-security/account-takeover
use case the *user themselves* initiated has a credible "strictly necessary"
argument under 5(3); analytics-style scoring does not.

Crucially, Scent is a **B2B SDK embedded in customers' applications**. The data
subjects are the *customer's* end-users. That makes the **customer the data
controller** (they own the user relationship, the privacy notice, the lawful basis,
and an existing Consent Management Platform spanning all their vendors) and
**Tindalabs the processor** (hosted) or tool vendor (self-host).

Today the SDK collects on `observe()` with no consent gate, persists unconditionally,
and the server stores the full client IP in plaintext with no retention limit or
data-subject deletion. That is shippable for a developer's own machine but blocks any
customer with a DPO and is non-compliant for collecting third parties' data.

## Decision

**The SDK respects and enforces consent. It never triggers (prompts for) it.**

1. **Privacy by default (fail-closed).** Collection, persistence, *and* transmission
   are OFF until explicitly permitted. Unknown/absent consent → collect nothing,
   store nothing, send nothing. This is the SDK default (a deliberate clean break,
   taken pre-1.0 while adoption is near-zero) and a positioning differentiator:
   "Scent collects nothing until your CMP says yes."

2. **No consent UI in core.** The SDK ships **no banner/dialog**. Triggering consent
   is the controller's job via their own CMP and privacy notice — an embedded SDK
   must not fragment a site's unified consent record with a competing prompt. Any
   helper component is a clearly-labelled, non-authoritative *example*, never core,
   never on by default.

3. **The controller declares the lawful basis; the SDK records and forwards it.**
   `basis: 'consent' | 'legitimate_interest' | 'strictly_necessary'` (default
   `'consent'`). The SDK does not decide legality — it enforces the gate the
   controller configures and attaches the declared basis to every snapshot.

4. **Read the host's existing consent, don't reinvent it.** First-class adapters for
   IAB **TCF v2** (`__tcfapi`), **Google Consent Mode** (`gtag('consent')`), and a
   generic resolver callback `consent: () => boolean | Promise<boolean>`.

5. **The gate covers persistence, not just the network.** The resurrection layers
   (localStorage/sessionStorage/IndexedDB/cookie/ETag) are themselves the 5(3)
   "device access" and must not write before consent. This composes with ADR-0002:
   consent gates *whether* we persist; PersistencePolicy gates *how much*.

6. **Data-subject rights are first-class.** Client: `scent.forget()` purges every
   local layer and surfaces the identity id; `scent.setConsent(false)` revokes
   forward collection. Server: `DELETE /v1/identity/:id` (Art. 17, cascading) and
   `GET /v1/identity/:id/export` (Art. 20).

7. **The server is the accountability + lifecycle point.** It records consent
   provenance per snapshot (`lawful_basis`, `consent_version`, `consented_at` — GDPR
   Art. 7(1) requires demonstrating consent), minimises the client IP by default
   (truncate/hash; full IP only behind an explicit, documented project setting), and
   enforces a per-project retention TTL with a sweeper.

8. **The public LiveStack stays client-only.** A server-backed public demo lives only
   as a *separate*, explicitly-consented "identity playground" where Tindalabs is the
   controller and ships a real gate. (Supersedes nothing; records the standing call.)

## Consequences

- The SDK gains a consent state machine; `observe()` and all persistence become
  no-ops until the gate opens. Existing integrations must grant consent (or declare a
  basis) to keep collecting — acceptable pre-1.0, and the honest default.
- Consent provenance must travel with the data and be stored immutably alongside each
  snapshot; the matching pipeline and schema must carry the new fields.
- IP minimisation slightly coarsens impossible-travel geo (a /24 still resolves city);
  this is the right trade and is documented as the default.
- A "GDPR & consent integration guide" (CMP wiring per basis, controller/processor
  split, DPA template) becomes a required doc — and turns a buying objection into a
  differentiator.
- Any new storage layer or signal added later must be gated behind both the consent
  state and the PersistencePolicy before shipping (extends ADR-0002's rule).
