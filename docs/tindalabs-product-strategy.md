# tindalabs.dev — Three-Product Narrative Strategy

## The thesis

Every browser session asks three questions that current tooling answers badly:

1. **What happened?** — APM and RUM tools miss the browser entirely, or give you raw events with no trace context. You have server traces but no visibility into what the user actually did before the request arrived.

2. **Is this a real human?** — Bot detection is usually a black box or a CAPTCHA. You have no structured signal about *why* a session looks suspicious, and no way to audit the detection logic.

3. **Is this the same entity as before?** — Cookie-based session IDs break constantly. FingerprintJS hashes break on browser updates. Neither gives you a calibrated confidence score or an explanation.

**tindalabs.dev answers all three** with a composable, self-hostable, explainable stack:

| Product | Question answered | npm scope |
|---|---|---|
| **Blindspot** | What happened in this session? | `@tindalabs/blindspot` |
| **Shield** | Is this a real human? | `@tindalabs/shield` |
| **Scent** | Is this the same entity as before? | `@tindalabs/scent` |

Each product is independently useful. Together they form a browser intelligence layer that no single vendor currently offers as open-source, self-hostable infrastructure.

---

## The narrative

**Tagline:** *"The browser intelligence layer."*

**One-paragraph pitch:**
> tindalabs.dev is three composable libraries that answer the questions your observability stack can't: what the user did before the request hit your server, whether the session came from a real human, and whether you've seen this entity before. Self-hosted, open-source, OpenTelemetry-native. Not a vendor. Infrastructure.

**Developer-first framing:**
These are not SaaS products you subscribe to. They are libraries you own. The data stays in your Postgres and Redis. The code is on GitHub and you can read it. The signals are documented and auditable by your DPO.

---

## The composition model

The three products compose through OpenTelemetry spans. Blindspot creates the trace. Shield and Scent annotate it.

```
Browser session
│
├── @tindalabs/blindspot
│     Creates route span, instruments clicks/fetches/vitals
│     Stores _routeSpan for cross-async traceparent access
│
├── @tindalabs/shield
│     Runs bot/tamper detection
│     Sets span attributes:
│       shield.automation.score
│       shield.webdriver.detected
│       shield.devtools.open
│       shield.patched_apis.count
│
└── @tindalabs/scent
      Collects signals (including shield results as input)
      Sets span attributes:
        scent.identity.id
        scent.identity.confidence
        scent.identity.continuity
        scent.risk.score
        scent.risk.flags
      Sends snapshot to server with traceparent

Server (scent-server)
  Identity resolution → OTel span
  Risk assessment → OTel span (reads shield signals from snapshot)

Grafana Tempo
  Every trace tagged with: who did it, whether they're real, risk score
  Filter by scent.identity.id to see an entity's full interaction history
```

This is the god trace: one span that answers all three questions, automatically, for every session.

---

## Per-product positioning and required changes

---

### Blindspot

**Current name:** blindspot-ux / `@blindspot/web`
**Proposed scope:** `@tindalabs/blindspot`

**Positioning under tindalabs.dev:**
> *"OTel for the browser. The observability foundation the other two products build on."*

Blindspot's core value — creating long-lived route spans in a browser environment where OTel context doesn't survive async boundaries — is what makes the entire composition possible. It is the trace carrier. Scent and Shield annotate it. Without Blindspot, there's no single trace that contains all three answers.

**Renaming rationale:** "blindspot-ux" is evocative but the `-ux` suffix undersells it. Under `@tindalabs/blindspot`, it's clearly part of the family and the "blind spot" metaphor still works perfectly — it's observability for what traditional APM misses.

**Changes needed:**

1. **npm scope migration:** `@blindspot/web` → `@tindalabs/blindspot`. Publish under the new scope; keep `@blindspot/web` as a deprecated re-export for existing users. One release cycle.

2. **Shield integration:** Accept Shield's `assess()` result as optional span attributes. When Shield is present, Blindspot's route span automatically gets `shield.*` attributes without any additional wiring:
   ```typescript
   import { setRouteSpanAttributes } from '@tindalabs/blindspot';
   import { assess } from '@tindalabs/shield';
   
   const shieldResult = assess();
   setRouteSpanAttributes(shieldResult.spanAttributes);
   ```

3. **`getSessionTraceparent()` is already shipped** (we added it in the previous session). This is the key API that enables Scent integration. No changes needed there.

4. **Documentation update:** README and docs should explicitly position Blindspot as the "observability foundation" for the tindalabs.dev stack, with cross-links to Scent and Shield integration guides.

5. **tindalabs.dev branding:** Update README header, package description, and repo description to reference tindalabs.dev.

**What NOT to change:** The core SDK architecture, the React/Vue adapter pattern, the OTel wiring. These are stable and correct.

---

### Shield

**Current name:** content-security-toolkit
**Proposed name:** `@tindalabs/shield`

**Positioning under tindalabs.dev:**
> *"Browser bot and tamper detection. The 'is this a real human?' layer."*

Shield answers the question that neither Blindspot nor Scent directly addresses: is this session being driven by a human, or by automation? It detects WebDriver, headless browsers, DevTools, patched APIs, and extension interference — and returns a structured assessment you can act on and audit.

**Renaming rationale:** "content-security-toolkit" is confusing (Content Security Policy is something else entirely), unmemorable, and doesn't suggest its purpose. "Shield" is short, evocative, and positions the library correctly: it's a defensive detection layer.

**Changes needed — this is the most work of the three:**

1. **Rename and restructure the package:**
   - Publish as `@tindalabs/shield`
   - Top-level `assess()` function that runs all detectors and returns a unified result:
     ```typescript
     import { assess } from '@tindalabs/shield';
     
     const result = assess();
     // result.score: 0–1 automation probability
     // result.flags: string[] — e.g. ["webdriver_detected", "devtools_open"]
     // result.details: { [detector]: { detected, confidence, reason } }
     // result.spanAttributes: Record<string, string|number|boolean> — ready to set on OTel span
     ```
   - Keep the individual detector exports for users who want granular control
   - Strategy pattern is already there — just needs a clean top-level API surface

2. **Scent integration:** The `result.score` and `result.flags` should flow into Scent's `init()` options as a pre-computed automation input, replacing the duplicated detector implementations that currently live inside Scent's SDK:
   ```typescript
   import { init } from '@tindalabs/scent';
   import { assess } from '@tindalabs/shield';
   
   const shieldResult = assess();
   
   const sdk = init({
     apiKey: '...',
     automationContext: shieldResult, // Scent skips its internal detectors if this is provided
   });
   ```
   This removes duplication: Scent's internal anti-tamper signals were copied from CST patterns. With Shield as a proper dependency, Scent imports the source of truth.

3. **OTel span attributes:** `result.spanAttributes` returns a flat object suitable for `span.setAttributes()`. When Blindspot is present, these get applied to the route span automatically via the Blindspot integration hook.

4. **Documentation:** Full README, `docs/signals.md` equivalent for Shield (which detectors run, what they detect, false positive rates, browser support).

5. **tindalabs.dev branding** in README and package description.

**What NOT to change:** The detection heuristics themselves — they're the IP. The strategy pattern architecture is already correct.

**Launch timing:** Do NOT launch Shield simultaneously with Scent. Ship Scent first. After Scent's HN post, launch Shield as *"the tamper detection layer that powers Scent's risk engine — now standalone."* That's a much stronger secondary launch than releasing two things at once.

---

### Scent

**Current name:** scent / `@tindalabs/scent-sdk`
**Proposed scope:** `@tindalabs/scent` (drop the `-sdk` suffix)

**Positioning under tindalabs.dev:**
> *"Probabilistic identity continuity. The 'have I seen this entity before?' layer."*

Scent's positioning doesn't need to change substantively — it's already correct. What changes is the explicit acknowledgment that it sits atop Blindspot (for trace context) and composes with Shield (for automation detection input).

**Changes needed — minimal:**

1. **npm package rename:** `@tindalabs/scent-sdk` → `@tindalabs/scent`. The `-sdk` suffix is redundant; the package is the SDK.

2. **Shield as optional input:** Accept `ShieldResult` via `automationContext` in `ScentInitOptions` (described above). When provided, Scent's internal automation detectors are skipped — Shield's result is used instead. This eliminates the duplication of detection logic.

3. **Explicit stack positioning in README:** The "how it works" section should mention that Scent composes with Blindspot for trace context and with Shield for automation input. Not required — just enhanced when both are present.

4. **`@tindalabs/scent-otel` rename consideration:** Could become `@tindalabs/scent/otel` (subpath export) to keep the package count tidy. Lower priority.

5. **`automationContext` in the snapshot payload:** When Shield results are provided, include `shield.score` and `shield.flags` in the snapshot sent to the server, so the risk engine can use them as high-quality pre-computed signals rather than re-running weaker heuristics server-side.

---

## The landing page — "three products, one story" section

The existing landing page spec (tindalabs-landing-page-spec.md) is Scent-only. When all three products are under the umbrella, the page needs one additional section between "How it works" and the feature highlights.

**New section — "The stack":**

```
Three questions. One trace.

Every browser session carries three unknowns.
tindalabs.dev answers all of them, in the same OpenTelemetry span.

┌─────────────────────────────────────────────────────────────┐
│  @tindalabs/blindspot                                       │
│  "What happened?"                                           │
│  OTel route spans, click/fetch/vitals instrumentation       │
│  → Creates the trace carrier                                │
├─────────────────────────────────────────────────────────────┤
│  @tindalabs/shield                                          │
│  "Is this a real human?"                                    │
│  WebDriver, headless, DevTools, patched API detection       │
│  → Sets shield.* attributes on the span                     │
├─────────────────────────────────────────────────────────────┤
│  @tindalabs/scent                                           │
│  "Is this the same entity as before?"                       │
│  Probabilistic identity, drift tracking, risk scoring       │
│  → Sets scent.identity.* and scent.risk.* on the span       │
└─────────────────────────────────────────────────────────────┘

The result: every Grafana Tempo trace tagged with identity,
automation probability, and risk score. Automatically.
```

The visual should be a stacked card animation — each product's card slides in sequentially, then the final span attribute list appears assembled from all three.

---

## GitHub org structure

```
github.com/tindalabs/
  ├── scent           @tindalabs/scent, @tindalabs/scent-otel
  ├── blindspot       @tindalabs/blindspot (web + react + vue)
  ├── shield          @tindalabs/shield (browser security)
  └── tindalabs.dev   landing page + docs site
```

Three repos, one org. No monorepo merge — each product has a distinct release cadence and contributor audience. A monorepo would complicate independent versioning without providing meaningful benefits.

---

## Sequencing — what to do in what order

1. **Now:** Launch Scent OSS. GitHub public, HN post, README as written.

2. **+2 weeks:** Rename CST → Shield (`@tindalabs/shield`), add top-level `assess()` API, publish to npm. Launch as "the bot detection layer behind Scent's risk engine."

3. **+4 weeks:** Migrate `@blindspot/web` to `@tindalabs/blindspot`. Keep old package as a deprecated re-export. One changelog note, no breaking changes.

4. **+6 weeks:** Update tindalabs.dev landing page with the three-product "stack" section. By now all three are published and stable.

5. **Later:** Scent `init()` accepts `automationContext` from Shield, eliminating internal duplication. This is a non-breaking enhancement.

**Why this order:** Scent is the hero and the hardest product to explain. Lead with it. Then introduce Shield as the layer that makes Scent's risk engine more accurate — you're giving existing Scent users an immediate reason to adopt Shield. Then fold in Blindspot as the observability foundation that was already powering the whole thing.

---

## What NOT to do

- **Don't launch all three simultaneously.** Splitting the narrative on launch day dilutes each product's story.
- **Don't merge into a monorepo.** Independent versioning and contributor onboarding are more important than shared build tooling at this stage.
- **Don't rebrand Scent.** The name is distinctive and memorable. "Scent by tindalabs.dev" is fine.
- **Don't position tindalabs.dev as a platform or a SaaS company.** It's an OSS organization. The products are libraries. The monetization (Phase 7) is hosted infrastructure, not the libraries themselves.
- **Don't add cross-product hard dependencies.** Each product must remain independently useful. The composition is additive, never required.
