# Ideal Customer Profile — Scent / tindalabs.dev

## Primary ICP: Mid-Market SaaS — The Abused Growth Stage

### Who they are

A SaaS company in the 50–500 employee range, typically Series A or B, experiencing measurable user fraud as a side effect of their own growth. They have at least one backend engineer and a frontend team. They are developer-led — buying decisions are made or heavily influenced by engineering, not procurement.

### The pain they feel acutely

- **Free tier abuse**: Throwaway accounts, unlimited trial extensions via re-registration, credit card testing
- **Account takeover (ATO)**: Credential stuffing from breached databases, session hijacking, bot-assisted logins
- **Bot signups inflating MAU metrics**: Vanity numbers that distort fundraising conversations and product analytics
- **Coordinated abuse**: Multiple "distinct" users that are clearly the same entity — same device, different emails

### Why they haven't solved it yet

- **Sift / Sardine / Kount are priced out**: Entry pricing starts at $1,000–3,000/month with long procurement cycles. A 200-person SaaS cannot justify this until fraud is already a fire.
- **FingerprintJS Pro is a black box**: Gives a visitor ID but no explainability, no drift tracking, no confidence score. When legal asks "what are you collecting?", there's no clean answer.
- **Rolling their own is painful**: Browser fingerprinting looks simple until you hit VPN changes, private mode, browser updates, and iOS Safari's aggressive ITP.
- **Their current stack has no identity layer**: PostHog for analytics, Sentry for errors, no tool bridging sessions to persistent identity.

### What they need from a solution

- Deployable in a sprint by one developer (not a 3-month vendor onboarding)
- Explainable: legal and security teams can audit exactly what signals are collected and why
- Self-hostable: GDPR/data residency concerns are real — they need first-party data ownership
- Composable: plugs into existing analytics / observability stack, not a replacement
- Honest pricing: usage-based, scales with their growth, no surprise overages

### Firmographics

| Attribute | Value |
|---|---|
| Size | 50–500 employees |
| Stage | Series A / B, or bootstrapped with significant revenue |
| MAU | 5k–500k (below this, fraud is not painful; above, they can afford Sift) |
| Market | B2B SaaS, developer tools, fintech-adjacent, marketplace, API products |
| Region | EU/UK or US with privacy-conscious legal teams |
| Stack | Web-first (React/Vue/Next.js), Node.js or any backend with a REST API |

### The buyer persona

**Primary:** Senior backend or full-stack engineer, or a founding engineer. Evaluates OSS projects on GitHub before booking a demo. Will self-host first, upgrade to cloud if it saves time.

**Secondary:** Head of Engineering or CTO at the 50–200 employee range who owns the security posture and needs something auditable to show the board.

**Economic buyer:** Same people, usually. Procurement is lightweight at this stage.

### Jobs to be done

1. "I need to know if the person creating their 5th free trial account is the same device as the previous four."
2. "I need a risk signal I can feed into my login flow without exposing my users' data to a third party."
3. "I need to tell my legal team exactly what we're collecting and why, with a config that limits collection to what's necessary."
4. "I need this to keep working when users clear cookies, switch browsers, or use a VPN."

### What success looks like for them

- Drop in free tier abuse rate within 30 days of deployment
- Confidence score integrated into login/signup risk logic within one sprint
- Zero new compliance incidents related to identity tracking
- Observatory UI that a non-technical founder can read to understand their fraud profile

---

## Secondary ICP: Privacy-Conscious Enterprise

Larger companies (500+ employees) in regulated industries — finance, healthcare, legal tech — who are being asked by their compliance team to **replace** an existing black-box fingerprinting vendor with something auditable. They are not primarily fighting fraud; they need an explainable, self-hosted alternative to FingerprintJS Pro that their DPO will sign off on.

The sale is longer, the contract is larger, and the feature priority is different: Persistence Policies, audit logs, SSO, and data residency are table stakes. This ICP becomes relevant in Phase 5+ once the core product is stable.

---

## Anti-ICP: Who Scent is not for

- Consumer apps building surveillance-grade tracking (ethical misalignment, legal exposure)
- Teams who want a drop-in FingerprintJS replacement with zero configuration
- Companies whose fraud problem is primarily payment fraud (they need Stripe Radar or a dedicated fraud suite)
- Solo developers with <1k MAU (the pain is not real yet)
