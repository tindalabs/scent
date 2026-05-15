# tindalabs.dev — Landing Page Design Spec

This document is a design brief for the tindalabs.dev landing page. It is intended to be passed to Claude Design or a frontend developer to implement. All copy, section structure, visual direction, and interaction notes are included.

---

## Product context

**Product:** Scent — open-source probabilistic identity continuity for hostile browser environments.
**Tagline:** "Still probably the same entity — even after they cleared cookies, switched browsers, and turned on a VPN."
**Core differentiator:** Probabilistic confidence scoring + full explainability + self-hostable. Not a black box, not a hash.

**Primary ICP:** Mid-market SaaS (50–500 employees, Series A/B) fighting free tier abuse and account takeover. Developer-led buying decision. Evaluates OSS on GitHub before booking a demo.

**Tone:** Developer-first. Precise and direct — no marketing fluff. Confident, not salesy. The reader is a senior engineer who is skeptical of vendor claims and will read the code before they trust the copy.

---

## Design direction

### Visual language

- **Dark theme only.** Background: `#0a0e1a` (deep navy-black). Not pure black — it should feel like a terminal or an IDE, not a generic dark SaaS site.
- **Accent color:** `#6366f1` (indigo-500). Used sparingly: CTAs, active states, key numbers. Glow effect on the primary CTA button (`box-shadow: 0 0 24px rgba(99, 102, 241, 0.4)`).
- **Typography:** Inter or Geist (if available). Monospace for code, IDs, signal names, and confidence values: `JetBrains Mono` or `Fira Code`.
- **Grid:** Max-width 1100px, centered, 24px column gap, generous vertical whitespace.
- **Cards:** `background: #111827`, `border: 1px solid #1f2937`, `border-radius: 10px`. Subtle `box-shadow: 0 1px 3px rgba(0,0,0,0.4)`.
- **No stock photos, no illustrations with people.** Use code blocks, terminal-style outputs, signal tables, and animated confidence bars.

### Visual motifs

The page should feel like a real product, not a concept. Use realistic-looking UI fragments:
- A confidence score meter that counts up: `0.00 → 0.91`
- A signal breakdown table with stability badges
- A drift event showing "18/20 signals matched"
- A risk flag badge reading `automation_suspected`

---

## Page sections

### 0. Navigation

```
[tindalabs.dev logo]          Docs    Observatory    GitHub ↗    [Get started →]
```

- Logo: wordmark in Inter, the dot in `tindalabs.dev` can be colored `#6366f1`
- Nav links: Docs, Observatory (links to localhost:4000 in dev, self-hosted in prod), GitHub (link to repo)
- CTA button: `Get started →` — filled indigo, pill shape, glow
- Sticky on scroll with `backdrop-filter: blur(12px)` and a thin `1px solid rgba(255,255,255,0.06)` bottom border

---

### 1. Hero

**Layout:** Full-width, centered vertically, ~90vh. Left column (copy) + right column (live terminal animation).

**Left column copy:**

```
Eyebrow (small caps, indigo):
PROBABILISTIC IDENTITY CONTINUITY

H1 (large, tight line-height):
Know your users,
even when they
don't want to be known.

Body (16px, slate-400):
Scent tracks whether a returning visitor is "likely the same
entity" even after cookie deletion, VPN changes, or browser
updates — using a drift-tolerant confidence engine, not hashes.

Developer-first. Self-hostable. Fully explainable.
```

**CTAs:**
```
[Get started free →]      [Read the docs]
```
- Primary: indigo filled with glow, links to GitHub repo quickstart
- Secondary: ghost/text, links to docs/concepts.md

**Right column — animated terminal block:**

A dark card that simulates a live `observe()` + `flush()` call:

```typescript
const sdk = init({
  apiKey: 'sk_live_...',
  persistence: 'balanced',
});

const obs = await sdk.observe();
await sdk.flush();
```

Below the code block, a result panel animates in (staggered, 400ms delay):

```
identity.id          8f3a-c29d-...
identity.continuity  ████ confirmed
identity.confidence  0.91
risk.score           0.07
risk.flags           []
```

The confidence bar should animate from 0 to 0.91 in ~800ms (ease-out). The `confirmed` badge should pulse once on appearance.

**Below hero:** A single row of trust signals in muted slate-500 text:
```
MIT License · Self-hostable · PostgreSQL + Redis · OTel-native · GDPR-configurable
```

---

### 2. Problem statement ("Why fingerprinting alone isn't enough")

**Layout:** Full-width section, dark card, centered, ~500px wide text column.

**Heading:**
```
Browser fingerprinting breaks.
Constantly.
```

**Body copy:**
```
A user updates Chrome. Their FingerprintJS visitor ID changes completely.
They clear cookies before signing up for their fifth free trial — new hash,
new visitor. They switch VPNs during a session — unknown entity.

The result: the same real-world person looks like five different users.
You miss the abuse, inflate your MAU, and flag real customers.

Deterministic hashes are brittle by design.
```

**Visual element:** A simple three-column illustration (code-style, not graphic):

```
User clears cookies    →    [FingerprintJS]   New visitor ID  ⚠
User updates browser   →    [FingerprintJS]   New visitor ID  ⚠
User switches VPN      →    [FingerprintJS]   New visitor ID  ⚠

User clears cookies    →    [Scent]           confidence: 0.76  confirmed ✓
User updates browser   →    [Scent]           confidence: 0.89  confirmed ✓
User switches VPN      →    [Scent]           confidence: 0.91  confirmed ✓
```

Style this as a comparison grid with two columns: one `[FingerprintJS]` with a red-tinted badge, one `[Scent]` with a green-tinted badge.

---

### 3. How it works

**Layout:** Three-step horizontal flow on desktop, vertical on mobile.

**Section heading:**
```
Signal → Similarity → Confidence
```

**Three steps:**

**Step 1 — Collect**
```
~50 browser signals
Canvas hash, audio fingerprint, font list, hardware concurrency,
screen geometry, timezone, anti-tamper heuristics.
Not raw data — derived, stability-weighted tokens.
```
Small signal badge cloud below: `canvas.hash` `audio.hash` `fonts.count` `hw.concurrency` `tz.offset` `webdriver` `…`

**Step 2 — Score**
```
Weighted Jaccard similarity
SimHash candidate lookup (O(log n)) against your identity store.
Per-signal comparison with stability weighting: a changed canvas
hash costs more than a changed IP address.
```
A mini visualization: two signal sets with overlapping circles. "18/20 signals matched. Confidence: 0.91."

**Step 3 — Explain**
```
Calibrated confidence + signal breakdown
Not a hash. A 0–1 probability with a human-readable explanation
of which signals matched, which drifted, and why.
```
A small table fragment:
```
Signal              Matched   Stability
canvas.hash         ✓         stable
audio.hash          ✓         stable
fonts.count         ✓         stable
screen.resolution   ✗         moderate   (changed: 1920×1080 → 2560×1440)
ua.version          ✗         volatile
```

---

### 4. Feature highlights

**Layout:** 2×2 grid of feature cards on desktop, 1-column on mobile.

**Card 1 — Drift detection**
```
Drift tracking
Every observation is diff'd against the last. You get a timeline
of exactly which signals changed, when, and how much — not just
a new ID with no explanation.

drift.entropy: 0.18  →  classification: moderate
```

**Card 2 — Risk engine**
```
Six anomaly detectors
Impossible geolocation transitions. Storage amnesia patterns.
Automation signatures. Coordinated behavior clusters.
Each flag comes with a reason string you can read.

risk.flags: ["automation_suspected", "storage_amnesia"]
```

**Card 3 — Persistence policies**
```
Compliance-first design
Four collection scopes: conservative → balanced → aggressive → forensic.
The policy controls exactly what is stored and transmitted.
Your DPO can audit it. Your legal team can sign off on it.

persistence: "conservative"  // session-only, GDPR-friendly
```

**Card 4 — Observatory UI**
```
A UI for humans
Identity timelines, signal explainability panels, risk dashboards,
cluster views. Ships with the Docker stack. No separate install.
```
Small screenshot or mockup of the Observatory identity detail page.

---

### 5. Comparison table

**Layout:** Full-width, centered.

**Heading:**
```
Not a FingerprintJS replacement.
A different model.
```

**Sub-copy:**
```
FingerprintJS computes a hash. Scent computes a probability.
The distinction matters when browsers, VPNs, and users fight back.
```

**Table:**

|  | FingerprintJS Pro | Scent |
|---|---|---|
| Approach | Deterministic hash | Probabilistic similarity |
| Browser update | New visitor | confidence: 0.91 |
| Cookie deletion | New visitor | Server-side resurrection |
| VPN change | Usually new visitor | Stable signals persist |
| Confidence score | Binary (visitorFound) | Calibrated 0–1 float |
| Explainability | None | Per-signal breakdown |
| Risk scoring | Basic | 6 anomaly detectors, named flags |
| Self-hostable | No | Yes |
| Open source | No | Yes (MIT) |
| Pricing | $0.002/req → $1,000+/mo | Free (self-hosted) |

Design: two highlighted columns with distinct background tints. Scent column has a subtle indigo left border. Rows alternate very slightly in background shade. The "Yes (MIT)" and "Yes" cells in the Scent column should be in `#4ade80` (green). The "No" cells in FingerprintJS column in muted slate.

---

### 6. Quickstart

**Layout:** Two-column. Left: numbered steps. Right: animated code block.

**Heading:**
```
Running in 5 minutes.
```

**Steps (left):**
```
1  Clone + start the stack
   docker compose up

2  Install the SDK
   npm install @tindalabs/scent-sdk

3  Instrument your app
   obs = await sdk.observe()
   await sdk.flush()

4  Open the Observatory
   localhost:4000
```

**Code block (right) — tabbed:**

Tab 1 `install`:
```bash
git clone https://github.com/tindalabs/scent
cd scent && docker compose up
```

Tab 2 `instrument`:
```typescript
import { init } from '@tindalabs/scent-sdk';

const sdk = init({
  apiKey: 'demo-api-key-dev',
  endpoint: 'http://localhost:3000/v1',
});

const obs = await sdk.observe();
await sdk.flush();

console.log(obs.identity.continuity); // "confirmed"
console.log(obs.identity.confidence); // 0.91
```

Tab 3 `login flow`:
```typescript
if (obs.identity.continuity === 'unknown' || obs.risk.score > 0.6) {
  // Challenge this user — step-up auth, CAPTCHA
  return stepUpAuth(obs.identity.id);
}
```

---

### 7. Use cases

**Layout:** Three horizontal cards, icon + title + 2-line description.

**Card 1 — Free tier abuse**
```
Catch serial re-registrators
Detect the same device signing up repeatedly with new email addresses.
Even when they clear cookies between attempts.
```

**Card 2 — Account takeover**
```
Flag credential stuffing
Automation signatures + impossible transitions + storage amnesia patterns
combine into a risk score you can gate your login flow on.
```

**Card 3 — Compliance-first tracking**
```
Replace your black-box vendor
Scent's Persistence Policies give your DPO a document to sign.
Conservative mode: session-only, GDPR-compatible.
```

---

### 8. Observatory preview

**Layout:** Full-width dark section, screenshot/mockup of Observatory centered.

**Heading:**
```
Identity intelligence, not just an ID.
```

**Sub-copy:**
```
The Observatory ships with every self-hosted deployment. Browse identities,
inspect signal profiles, track drift timelines, and investigate suspicious
clusters — without leaving your own infrastructure.
```

**Visual:** Mockup (or actual screenshot) of the Observatory identity detail page. Should show:
- Confidence bar at 0.91 ("confirmed")
- Signal profile table with stability classes
- Risk flags section (even if empty for this demo)
- Drift timeline chart

If a real screenshot is available, use it. Otherwise, a dark wireframe mockup is fine.

---

### 9. Self-hosting section

**Layout:** Dark card, centered, two-column (text + terminal).

**Left — copy:**
```
Your data. Your servers.
No telemetry, no call-home, no per-request pricing.
Scent runs entirely on your infrastructure.
One Docker Compose file brings up the full stack.
```

**Architecture list:**
```
● scent-server     Node.js API (port 3000)
● scent-observatory  React UI (port 4000)
● PostgreSQL       Identity graph + drift history
● Redis            Rate limiting + session cache
● OTel Collector   Trace forwarding (optional)
● Grafana Tempo    Distributed tracing (optional)
```

**Right — terminal:**
```bash
$ docker compose up

✓ postgres       healthy
✓ redis          healthy
✓ scent-server   listening on :3000
✓ observatory    serving on :4000
```

---

### 10. Footer CTA

**Layout:** Full-width, centered, generous padding.

```
Ready to know who's really there?

[Get started on GitHub →]        [Read the docs]
```

- Primary CTA: GitHub repo
- Secondary: /docs link

**Footer nav (below):**
```
tindalabs.dev   Docs   API   Signals   Persistence Policies   GitHub   MIT License
```

---

## Interaction notes

- **Scroll-triggered animations:** Sections fade + slide up on entry. Use `IntersectionObserver`, threshold 0.15, 60ms stagger between sibling elements.
- **Confidence meter in hero:** Counts from 0.00 to 0.91 over 800ms using `requestAnimationFrame`. Triggered once on viewport entry.
- **Code block tabs:** Simple JS tab switcher. No external dependency needed.
- **Comparison table:** On mobile, collapse to a card-per-row format with FingerprintJS vs Scent stacked vertically per attribute.
- **No cookie banners, no chat widgets, no tracking pixels** — this would be ironic.

---

## Technical implementation notes

- **Framework:** Next.js (App Router) or plain Vite + vanilla HTML/CSS/TS. Static export preferred — no server rendering needed.
- **CSS:** Tailwind v3 acceptable. Custom CSS also fine. Dark mode is the only mode — no light/dark toggle needed.
- **Fonts:** Load Inter from Bunny Fonts (privacy-preserving CDN) or self-host. JetBrains Mono for monospace.
- **No external analytics** — the product is literally about privacy. If analytics are needed, use Plausible self-hosted.
- **Meta tags:** OG image with the tagline and a confidence bar visual. Twitter card. Canonical URL `https://tindalabs.dev`.

---

## Content not yet available

- Real Observatory screenshot (take once the demo stack is running: `docker compose up`, open `localhost:4000`)
- Final GitHub repo URL
- Production `tindalabs.dev` domain DNS

These can be added as placeholder `[TODO: screenshot]` and `[TODO: github-url]` in the implementation.
