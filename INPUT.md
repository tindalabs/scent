Excellent. Now the product shape is becoming very clear.

You are not building:

“another browser fingerprint library”.

You are building:

an open-source probabilistic identity continuity and anomaly intelligence platform.

That is a MUCH stronger positioning.

And honestly, the combination:

probabilistic identity
aggressive persistence
observability SDK
fully OSS
full-stack
SaaS + cyber + privacy-oriented audience

puts you in a very interesting space between:

FingerprintJS
PostHog
Sentry
CrowdSec
device intelligence platforms
fraud engines

without being identical to any of them.

My recommendation on the privacy stance

Since “privacy-first” is not the core mission here, I would NOT artificially constrain the product.

Instead:

Proposed stance
“Transparent device intelligence.”

Meaning:

explicit documentation of collected signals
explainable scoring
modular signal collection
opt-in invasive plugins
first-party ownership by default
self-hosting encouraged
no hidden telemetry

This is MUCH stronger than fake “privacy-washing”.

You gain:

cybersecurity credibility
OSS trust
enterprise usability
flexibility

without crippling the platform.

VERY IMPORTANT:
Your real moat is NOT fingerprinting

Fingerprinting alone is commoditized.

Your moat is:

Identity continuity under entropy drift.

That is the genuinely hard problem.

Meaning:

browser updates
VPN changes
storage deletion
canvas variance
hardware drift
anti-fingerprinting browsers
mobile instability
private mode transitions

Yet:

still estimating “likely same entity”.

That is MUCH more sophisticated than hash-based fingerprinting.

This needs to become the heart of the MVP.

Strategic recommendation

I strongly recommend structuring Scent around:

1. Signals

Raw entropy collection.

2. Identity

Probabilistic continuity engine.

3. Drift

Tracking signal evolution over time.

4. Risk

Anomaly and abuse scoring.

5. Persistence

Multi-layer recovery mechanisms.

That becomes a coherent architecture.

Another very important recommendation

DO NOT call the generated identifier:

fingerprint
visitor id
browser id

Those are commoditized terms.

Invent your own vocabulary.

Examples:

scent
trail
residue
echo
signature
profile
shadow
continuity graph

Example:

const scent = await sdk.observe()
console.log(scent.identity.confidence)

This matters more than people think.

Your MVP should probably focus on:
Core narrative

“Persistent probabilistic identity for hostile and unstable environments.”

That is strong.

Here is the architecture I now envision
Client SDK (@tindalabs/scent)

Responsibilities:

signal collection
local persistence
drift snapshots
anti-tampering checks
transport
event buffering
Identity Engine

Responsibilities:

probabilistic matching
confidence scoring
drift tolerance
continuity estimation
cluster linking
Persistence Layer

Responsibilities:

multi-storage redundancy
resurrection strategies
signal recovery
continuity heuristics
Risk Engine

Responsibilities:

anomaly detection
impossible transitions
entropy instability
automation suspicion
coordinated behavior
Observatory UI

Responsibilities:

identity timelines
drift visualization
confidence evolution
entropy breakdowns
signal explainability
Features I already consider NON-NEGOTIABLE for MVP

Even before drafting the full document.

Absolutely essential
Probabilistic identity scoring

Not deterministic hashes.

Fingerprint drift tracking

Core differentiator.

Confidence-based identity continuity

Example:

93% likely same entity.

Multi-storage persistence

Including:

localStorage
sessionStorage
IndexedDB
cookies
cache strategies
ETag-assisted continuity
optional service worker persistence
Signal weighting engine

Some signals must decay over time.

Explainable entropy model

Show:

which signals matched
which changed
why confidence dropped

This is HUGE for enterprise trust.

Anti-tampering heuristics

Detect:

automation
patched APIs
webdriver inconsistencies
entropy spoofing
Drift timeline

One of the killer features.

Visualize:

how identity evolved.
Self-hosting first

Critical for OSS credibility.

Plugin architecture

Non-negotiable.

Because invasive/high-risk signals should be modular.

Event ingestion API

Needed for observability positioning.

Identity graph model

Not just flat fingerprints.

Things I would AVOID in MVP

These are rabbit holes.

Session replay

Huge complexity and privacy burden.

ML-heavy models

Start heuristically.

You can add ML later.

Cross-device linking

Too ambitious initially.

Mobile native SDKs

Web first.

Browser exploit tricks

Don’t become “malware-adjacent”.

One concern you should think hard about

Aggressive persistence can VERY quickly become:

legally risky
ethically gray
enterprise-scary

So I strongly recommend:

“Persistence Policies”

Example:

scent.init({
  persistence: "balanced"
})

Modes:

conservative
balanced
aggressive
forensic

This is EXTREMELY smart strategically.

It lets:

privacy companies adopt you
cyber teams go full aggressive
OSS community trust the project

without fragmenting architecture.

Final thought

I think the strongest framing for Irregular/Scent is NOT:

“browser fingerprinting”

but:

“Probabilistic identity continuity.”

That phrase is:

technically sophisticated
differentiated
broad
future-proof
investor-friendly
cyber-friendly

And honestly?
Much more intellectually interesting.