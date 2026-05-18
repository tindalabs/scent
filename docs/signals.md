# Signal Reference

This document is the authoritative reference for every signal Scent collects. It is intended for three audiences: engineers integrating the SDK, DPOs and legal counsel auditing data collection, and AI agents working on the codebase.

Signal collection and signal persistence are **separate concerns**. Every signal listed here is collected on every `observe()` call regardless of the active `PersistencePolicy`. The policy controls only what is written to browser storage and transported to the server — see [Persistence Policies](#persistence-policies) below.

---

## Stability classes

Each signal is assigned a stability class that controls its base weight in the server-side identity engine. A signal that changes often contributes less to identity continuity than one that is rock-solid across sessions.

| Class | Base weight | Meaning | Examples |
|---|---|---|---|
| `stable` | 0.9 | Rarely or never changes for a real user on the same device | Canvas hash, audio hash, font list, hardware concurrency |
| `moderate` | 0.55 | Changes infrequently — browser updates, OS upgrades, user preference changes | Screen resolution, locale, plugins, CSS media preferences |
| `volatile` | 0.15 | Can change every session | Network type, anti-tamper flags |

Weights are also subject to **time-decay** (exponential, ~50% at 90 days) and **absence decay**: a signal absent from 3+ consecutive observations for a given identity has its weight halved; 6+ observations cuts it to 25%. See [Identity engine behaviour](#identity-engine-behaviour) below.

---

## Standard signal reference

These signals are collected on every `observe()` call across all persistence policies.

### Canvas (`canvas.*`)

**Collector:** `CanvasCollector` · **Stability:** `stable` · **File:** `packages/sdk/src/collectors/canvas.ts`

| Signal key | Type | Description |
|---|---|---|
| `canvas.2d` | `string` | DJB2 hash of a deterministic 2D canvas drawing. Encodes font rendering, subpixel antialiasing, and GPU compositing differences across OS/browser/driver combinations. |
| `canvas.webgl` | `string` | DJB2 hash of `UNMASKED_VENDOR_WEBGL + UNMASKED_RENDERER_WEBGL`. Identifies the GPU make/model and driver. Absent if WebGL is unavailable or the extension is blocked. |

**Browser support:** All modern browsers. Absent in privacy-hardened configurations (Tor Browser, Brave with Shields up) — detected separately by `EntropySpoofCollector`.

**Stability notes:** Identical across sessions on the same OS/browser/GPU combination. Changes on GPU driver update, major browser version, or OS upgrade. One of the highest-weight signals in the identity model.

---

### Audio context (`audio.*`)

**Collector:** `AudioCollector` · **Stability:** `stable` · **File:** `packages/sdk/src/collectors/audio.ts`

| Signal key | Type | Description |
|---|---|---|
| `audio.hash` | `string` | Hash of an `OfflineAudioContext` oscillator output buffer. Encodes differences in the OS audio processing pipeline. |

**Browser support:** Chrome 35+, Firefox 25+, Safari 14.1+. Absent in environments without `OfflineAudioContext` (some mobile WebViews, Node.js).

**Stability notes:** Highly stable across sessions. Changes only on OS audio subsystem update or browser audio engine change (rare). Resistant to anti-fingerprinting tools that only target canvas.

---

### Fonts (`fonts.*`)

**Collector:** `FontCollector` · **Stability:** `stable` · **File:** `packages/sdk/src/collectors/fonts.ts`

| Signal key | Type | Description |
|---|---|---|
| `fonts.list` | `string` | Comma-separated sorted list of detected installed fonts, from a probe set of ~50 common fonts across Windows, macOS, and Linux. Detection uses canvas text measurement — no Flash, no Java. |

**Browser support:** All modern browsers.

**Stability notes:** Stable for a given user's OS installation. Changes when fonts are installed or removed (rare). The probe set size (~50 fonts) is intentionally modest — larger sets add minimal entropy at the cost of collection time. The server computes Jaccard similarity on this set for drift-tolerant matching.

---

### Screen geometry (`screen.*`)

**Collector:** `ScreenCollector` · **Stability:** `moderate` · **File:** `packages/sdk/src/collectors/screen.ts`

| Signal key | Type | Description |
|---|---|---|
| `screen.width` | `number` | Physical screen width in CSS pixels. |
| `screen.height` | `number` | Physical screen height in CSS pixels. |
| `screen.avail_width` | `number` | Available width (excluding taskbars, docks). |
| `screen.avail_height` | `number` | Available height (excluding taskbars, docks). |
| `screen.color_depth` | `number` | Color depth in bits (typically 24 or 30). |
| `screen.dpr` | `number` | Device pixel ratio. Encodes HiDPI/Retina status. |

**Browser support:** All browsers.

**Stability notes:** Stable for a given monitor configuration. Changes when the user attaches/detaches a monitor, changes resolution, or moves the browser to a different display. `avail_*` changes when taskbar size changes. Lower weight than canvas/audio in the identity model.

---

### Locale and timezone (`locale.*`)

**Collector:** `LocaleCollector` · **Stability:** `moderate` · **File:** `packages/sdk/src/collectors/locale.ts`

| Signal key | Type | Description |
|---|---|---|
| `locale.timezone` | `string` | IANA timezone string from `Intl.DateTimeFormat` (e.g. `Europe/Madrid`). |
| `locale.language` | `string` | Primary browser language (e.g. `es-ES`). |
| `locale.languages` | `string` | Comma-separated full `navigator.languages` list (e.g. `es-ES,es,en`). |

**Browser support:** All modern browsers.

**Stability notes:** Stable for most users. Changes on VPN activation (timezone mismatch is a fraud signal — handled by the risk engine), travel, or browser language setting change. A mismatch between `locale.timezone` and the inferred IP timezone is a coordinated-behavior indicator.

---

### Hardware (`hardware.*`)

**Collector:** `HardwareCollector` · **Stability:** `stable` · **File:** `packages/sdk/src/collectors/hardware.ts`

| Signal key | Type | Description |
|---|---|---|
| `hardware.concurrency` | `number` | Logical CPU core count (`navigator.hardwareConcurrency`). |
| `hardware.memory` | `number` | Device RAM in GB, rounded to the nearest power of 2 (`navigator.deviceMemory`). Absent in Firefox and Safari. |

**Browser support:** `hardwareConcurrency` — all modern browsers. `deviceMemory` — Chrome 63+ only; absent otherwise (signal key omitted, not null).

**Stability notes:** Highly stable. Changes only on hardware replacement. Low cardinality (most devices cluster around 4–16 cores, 4–16 GB RAM) but useful in combination with other signals.

---

### Platform (`platform.*`)

**Collector:** `PlatformCollector` · **Stability:** `moderate` · **File:** `packages/sdk/src/collectors/platform.ts`

| Signal key | Type | Description |
|---|---|---|
| `platform.os` | `string` | Coarse OS name (e.g. `Windows 10+`, `macOS`, `Android 14`, `iOS`). |
| `platform.os_version` | `string` | OS version string. Present only when UA Client Hints are available (Chrome 90+). |
| `platform.arch` | `string` | CPU architecture (e.g. `x86`, `arm`). Present only via UA Client Hints. |
| `platform.mobile` | `boolean` | Whether the browser identifies as a mobile device. |
| `platform.model` | `string` | Device model string. Present only via UA Client Hints on mobile. |
| `platform.vendor` | `string` | `navigator.vendor` (e.g. `Google Inc.`). Present only on UA string fallback path. |

**Browser support:** UA Client Hints (structured, reliable) — Chrome 90+. All other browsers fall back to coarse UA string parsing. Raw UA string is **never stored** — only derived tokens.

**Stability notes:** Coarse OS token is very stable. `os_version` and `arch` change on OS upgrade. `platform.mobile` is binary and highly stable.

---

### Touch and pointer (`input.*`)

**Collector:** `TouchCollector` · **Stability:** `stable` · **File:** `packages/sdk/src/collectors/touch.ts`

| Signal key | Type | Description |
|---|---|---|
| `input.touch_points` | `number` | Maximum simultaneous touch points (`navigator.maxTouchPoints`). 0 = no touch. |
| `input.pointer` | `string` | Primary pointer precision: `fine` (mouse/trackpad), `coarse` (touchscreen/stylus), or `none`. Derived from the `pointer` CSS media feature. |

**Browser support:** All modern browsers.

**Stability notes:** Very stable for a given device. Changes only when attaching/detaching input devices or switching between desktop and tablet mode (Windows Surface-style).

---

### Network (`network.*`)

**Collector:** `NetworkCollector` · **Stability:** `volatile` · **File:** `packages/sdk/src/collectors/network.ts`

| Signal key | Type | Description |
|---|---|---|
| `network.type` | `string` | Effective connection type: `4g`, `3g`, `2g`, or `slow-2g`. |
| `network.downlink` | `number` | Estimated downlink bandwidth in Mbps, rounded to 0.25 Mbps increments. |

**Browser support:** NetworkInformation API — Chrome 61+, Firefox 31+ (partial). **Absent in Safari and Firefox 79+.** Both keys are omitted if the API is unavailable.

**Stability notes:** Volatile — changes every session. Low weight in the identity model. Used primarily as a supporting signal for the risk engine (sudden shifts from 4g to 2g across sessions may indicate device sharing or SIM swap).

---

### Plugins (`plugins.*`)

**Collector:** `PluginCollector` · **Stability:** `moderate` · **File:** `packages/sdk/src/collectors/plugins.ts`

| Signal key | Type | Description |
|---|---|---|
| `plugins.list` | `string` | Comma-separated sorted list of plugin names from `navigator.plugins`. |

**Browser support:** Chrome exposes a reduced plugin list. Firefox returns an empty list since v109. Safari returns an empty list. The signal is absent if `navigator.plugins` is empty.

**Stability notes:** Declining entropy as browsers restrict plugin access. Still useful as a browser differentiator on Chrome. Jaccard-compared server-side.

---

### CSS media preferences (`media.*`)

**Collector:** `MediaCollector` · **Stability:** `moderate` · **File:** `packages/sdk/src/collectors/media.ts`

| Signal key | Type | Description |
|---|---|---|
| `media.dark_mode` | `boolean` | Whether `prefers-color-scheme: dark` is active. |
| `media.reduced_motion` | `boolean` | Whether `prefers-reduced-motion: reduce` is active. |
| `media.hdr` | `boolean` | Whether `dynamic-range: high` (HDR display) is active. |

**Browser support:** All modern browsers.

**Stability notes:** Stable for a given user's OS preferences. Changes when the user toggles dark mode, accessibility settings, or moves to a non-HDR display. Low individual entropy but adds signal when combined with `screen.*` and `hardware.*`.

---

## Anti-tamper signal reference

Anti-tamper signals are **risk indicators**, not identity signals. They feed into the risk engine (Phase 3) rather than the identity matching model. They are volatile by definition — a signal being true in one session and false in another is expected and meaningful.

### WebDriver detection (`tamper.webdriver`, `tamper.cdp`, `tamper.playwright`)

**Collector:** `WebDriverCollector` · **File:** `packages/sdk/src/collectors/anti-tamper/webdriver.ts`

| Signal key | Type | What it detects |
|---|---|---|
| `tamper.webdriver` | `boolean` | `navigator.webdriver === true` — standard W3C WebDriver flag set by Selenium, Playwright, and Puppeteer. |
| `tamper.cdp` | `boolean` | Presence of Chrome DevTools Protocol injection artifacts in `window` or `document`. |
| `tamper.playwright` | `boolean` | Presence of `__playwright` or `__pw_manual` on `window`. |

**Notes:** A `true` value means automation is highly likely. Not a foolproof signal — sophisticated bots patch these values — but reliable for naive automation.

---

### Headless browser heuristics (`tamper.no_plugins`, `tamper.screen_inconsistent`, `tamper.headless_chrome`)

**Collector:** `HeadlessCollector` · **File:** `packages/sdk/src/collectors/anti-tamper/headless.ts`

| Signal key | Type | What it detects |
|---|---|---|
| `tamper.no_plugins` | `boolean` | `navigator.plugins.length === 0` — historically true in headless Chrome; less reliable since browsers started returning empty lists anyway. |
| `tamper.screen_inconsistent` | `boolean` | `window.outerWidth > screen.width` — headless environments often report viewport larger than the declared screen. |
| `tamper.headless_chrome` | `boolean` | `HeadlessChrome` substring in `navigator.userAgent`. |

**Notes:** No single heuristic is conclusive. The risk engine combines them with WebDriver signals for a composite automation score.

---

### Patched API detection (`tamper.canvas_patched`, `tamper.get_context_patched`, `tamper.webgl_patched`)

**Collector:** `PatchedApiCollector` · **File:** `packages/sdk/src/collectors/anti-tamper/patched-api.ts`

| Signal key | Type | What it detects |
|---|---|---|
| `tamper.canvas_patched` | `boolean` | `HTMLCanvasElement.prototype.toDataURL` has been overridden (loses `[native code]` marker). |
| `tamper.get_context_patched` | `boolean` | `HTMLCanvasElement.prototype.getContext` has been overridden. |
| `tamper.webgl_patched` | `boolean` | `WebGLRenderingContext.prototype.getParameter` has been overridden. |

**Notes:** Anti-fingerprinting browser extensions (LibreWolf, Brave Shields, canvas-fingerprint-defender) commonly patch these methods to return randomised output. When any of these flags is `true`, the identity engine excludes the corresponding canvas/WebGL signals from the SimHash and downgrades their Jaccard weight to 0 for that snapshot.

---

### DevTools presence (`tamper.devtools_open`)

**Collector:** `DevToolsCollector` · **File:** `packages/sdk/src/collectors/anti-tamper/devtools.ts`

| Signal key | Type | What it detects |
|---|---|---|
| `tamper.devtools_open` | `boolean` | Whether browser DevTools appear to be open, based on the difference between `outerWidth/Height` and `innerWidth/Height` exceeding 160px. |

**Notes:** A risk signal, not a blocking signal. Developer users legitimately have DevTools open. Elevated risk only when combined with other automation or spoofing indicators.

---

### Canvas entropy spoofing (`tamper.canvas_noise_spoofed`)

**Collector:** `EntropySpoofCollector` · **File:** `packages/sdk/src/collectors/anti-tamper/entropy-spoof.ts`

| Signal key | Type | What it detects |
|---|---|---|
| `tamper.canvas_noise_spoofed` | `boolean` | Whether two identical canvas drawings produce different `toDataURL()` outputs, indicating per-render random noise injection (Tor Browser behaviour, canvas-fingerprint-defender). |

**Notes:** When `true`, `canvas.2d` from this session is unreliable for identity matching. The identity engine excludes `canvas.2d` from the SimHash and sets its Jaccard weight to 0 for the affected snapshot.

---

### Storage mode (`storage.*`)

**Collector:** `StorageModeCollector` · **Stability:** `volatile` · **File:** `packages/sdk/src/collectors/storage-mode.ts`

| Signal key | Type | Description |
|---|---|---|
| `storage.restricted` | `boolean` | Whether storage access is restricted, indicating private/incognito browsing. Detection: Safari private mode throws `SecurityError` on `localStorage.setItem`; Chrome/Firefox private mode reports quota below 120 MB via `navigator.storage.estimate()`. |

**Browser support:** `localStorage` exception path covers all browsers. `StorageManager.estimate()` — Chrome 52+, Firefox 57+. Absent in environments without `localStorage` (e.g. some WebViews in strict mode).

**Stability notes:** Volatile — changes each session depending on whether the user opens private mode. A risk indicator, not an identity signal. Feeds the risk engine's storage amnesia pattern detector. `true` combined with a fresh-looking identity profile is a stronger abuse signal than either alone.

**GDPR notes:** This signal does not expose the content of the user's storage. It only detects whether storage is available.

---

## Opt-in signals

These signals are available but require explicit opt-in via `init()` options because of their invasiveness. They are not collected unless the gate flag is set to `true`.

### WebRTC IP (`webrtc.*`)

**Collector:** `WebRTCCollector` · **Gate:** `options.signals.webrtc: true` · **Stability:** `volatile` · **File:** `packages/sdk/src/collectors/webrtc.ts`

| Signal key | Type | Description |
|---|---|---|
| `webrtc.local_ips` | `string` | Comma-separated sorted list of IP addresses (IPv4 and IPv6) discovered via RTCPeerConnection STUN candidate gathering. Includes RFC-1918 private addresses, which often remain stable across VPN changes. |
| `webrtc.public_ip` | `string` | First non-private IP found in the STUN candidate list. May reveal the real public IP behind a VPN when the user's browser does not block WebRTC IP leaks. Absent if all discovered IPs are private. |

**Browser support:** All modern browsers. Some privacy-hardened configurations (Brave Shields, Firefox `media.peerconnection.enabled: false`) block STUN candidate gathering — collector returns `{}` gracefully.

**Stability notes:** Local IPs are moderately stable (home router assignments are usually persistent); public IP changes with VPN. The primary fraud value is same-device correlation: two sessions sharing a `webrtc.local_ips` value despite different public IPs or cookies are very likely the same physical device.

**GDPR / legal notes:** Requires **explicit consent** (`Art. 6(1)(a)`) — cannot rely on legitimate interests. Exposing a user's local network topology without consent is not proportionate under most EU DPA guidance. Gate this signal behind a consent check in your application before enabling `options.signals.webrtc: true`.

---

## Deferred opt-in signals

| Signal group | Gate | Planned keys | Reason for opt-in |
|---|---|---|---|
| Battery API | `options.signals.battery: true` | `battery.level`, `battery.charging` | Highly invasive; removed from Firefox and Safari; deprecated in Chrome — low priority |

---

## Identity engine behaviour

This section describes how the server-side engine (`packages/engine`) uses the signals above to resolve identity continuity. It is primarily for engineers and DPOs auditing the matching logic.

### Signal weighting

The engine computes a **weighted Jaccard similarity** between an incoming snapshot and each stored identity profile. Each signal contributes weight according to its stability class (see table above). Tamper signals (`tamper.*`) are excluded from the Jaccard computation — they feed the risk engine, not identity continuity scoring.

### Drift tolerance

By default the engine **tolerates 1 mismatch** before penalising confidence. The highest-weight mismatched signal is removed from both sides of the Jaccard ratio rather than counted against the identity. This means a single canvas hash change (e.g. from a browser update) does not drop a `confirmed` identity to `probable`. Tolerance is configurable per `weightedJaccard()` call and will be exposed as a per-project setting in Phase 7.

### Confidence bands

| Band | Score range | `continuity` value | Meaning |
|---|---|---|---|
| `high` | ≥ 0.85 | `confirmed` | Very likely the same entity |
| `medium` | 0.60–0.84 | `probable` | Probably the same entity; recommend step-up auth |
| `low` | 0.35–0.59 | `uncertain` | Possible match; treat as suspicious |
| `unknown` | < 0.35 | `unknown` | No match found; new identity created |

### Signal decay

Each identity carries a per-signal absence history. If a signal is absent from an incoming snapshot that would otherwise have matched:

- **3–5 consecutive absences**: base weight × 0.5 for that identity
- **6+ consecutive absences**: base weight × 0.25 for that identity

This prevents a browser API going silent (e.g. `hardware.memory` removed in a future browser) from permanently penalising a returning identity.

### Candidate retrieval

Before running full Jaccard comparison the engine computes a 64-bit **SimHash** of each snapshot's stable signals and filters candidates by Hamming distance ≤ 10 bits. Only candidates passing this filter undergo weighted Jaccard scoring.

### Cluster linking

When two stored identities both score ≥ 0.90 against the same incoming snapshot, they are linked into a coordination cluster. The merge is recorded in the `cluster_merges` audit table with confidence score and reason.

### Anti-tamper signal integration

| Tamper flag | Effect on matching |
|---|---|
| `tamper.canvas_patched`, `tamper.webgl_patched` | `canvas.*` and `webgl.*` signals excluded from SimHash and Jaccard for this snapshot |
| `tamper.canvas_noise_spoofed` | `canvas.2d` excluded from SimHash and Jaccard weight set to 0 |
| `tamper.webdriver`, `tamper.cdp`, `tamper.playwright` | Passed to risk engine; no effect on identity confidence |
| `tamper.headless_*` | Passed to risk engine; no effect on identity confidence |
| `tamper.devtools_open` | Passed to risk engine; no effect on identity confidence |

---

## Persistence policies

The `PersistencePolicy` controls which **storage layers** receive the identity token and snapshot data. Signal **collection** always runs in full regardless of policy. The policy is a compliance lever, not a collection filter.

| Layer | `conservative` | `balanced` | `aggressive` | `forensic` |
|---|:---:|:---:|:---:|:---:|
| `localStorage` | | ✓ | ✓ | ✓ |
| `sessionStorage` | | | ✓ | ✓ |
| `IndexedDB` | | | ✓ | ✓ |
| First-party cookie | ✓ | ✓ | ✓ | ✓ |
| Cache Storage / Service Worker | | | | ✓ |
| ETag continuity (server-assisted) | | | ✓ | ✓ |

**Policy descriptions:**

- **`conservative`** — Cookie only, session-scoped. Appropriate for GDPR-strict environments where persistent cross-session tracking requires explicit consent. Identity continuity is limited to sessions within the cookie lifetime.
- **`balanced`** *(default)* — localStorage + cookie. Provides good continuity for most SaaS use cases. Survives browser restarts. Appropriate under legitimate-interests basis for fraud prevention.
- **`aggressive`** — All standard storage layers. Maximum continuity. Survives most cookie/storage clearing patterns. Appropriate for fraud/security teams under explicit legitimate-interests documentation.
- **`forensic`** — All layers including Cache Storage and ETag. For incident response and abuse investigation. Should require explicit user acknowledgement in your product's privacy policy.

---

## GDPR and ePrivacy notes

> **This is informational context, not legal advice.** Consult your DPO before deploying in the EU or UK.

### Legal basis by signal group

| Signal group | Typical Article 6 basis | Notes |
|---|---|---|
| Anti-tamper signals (`tamper.*`) | Art. 6(1)(f) Legitimate interests | Fraud detection and security hardening are widely recognised legitimate interests. |
| Identity continuity signals (`canvas.*`, `audio.*`, `fonts.*`, `hardware.*`) | Art. 6(1)(f) Legitimate interests | Must be documented in a LIA. Necessity and proportionality must be demonstrable. |
| Behavioural/preference signals (`locale.*`, `media.*`, `screen.*`) | Art. 6(1)(f) Legitimate interests | Low-sensitivity; generally proportionate for fraud prevention. |
| Volatile signals (`network.*`, `platform.*`) | Art. 6(1)(f) Legitimate interests | Low individual sensitivity. |
| Opt-in invasive signals (WebRTC, Battery) | Art. 6(1)(a) Consent | Must be gated behind explicit, informed consent. Cannot rely on legitimate interests. |

### ePrivacy Directive (cookie law)

Accessing `localStorage`, `IndexedDB`, `cookies`, and `Cache Storage` requires a legal basis under the ePrivacy Directive (implemented as cookie laws in EU member states), **separate from** the GDPR Article 6 basis. In practice this means:

- **`conservative` policy** (cookie only) typically requires consent in the EU unless the processing falls under the "strictly necessary" exemption (which fraud prevention may qualify for — jurisdiction-dependent).
- **`balanced` and above** typically require either consent or a documented strictly-necessary exemption.
- **Self-hosted deployments** should consult their DPO. Cloud deployments inherit Scent's data processing addendum.

### What is NOT collected

Scent deliberately does not collect:
- Raw `navigator.userAgent` string (only parsed tokens)
- IP addresses (the server may log these separately under its own retention policy)
- Page content, URLs, or navigation history
- User input of any kind
- Cross-origin data

---

## Adding a new collector

1. Create `packages/sdk/src/collectors/<name>.ts` extending `BaseCollector`
2. Assign a `name` (dot-namespaced, e.g. `webrtc.ip`), `stabilityClass`, and implement `collect(): Promise<SignalRecord>`
3. Add it to `buildCollectors()` in `packages/sdk/src/collectors/index.ts` (gate behind `options.signals.*` if invasive)
4. Add its signal keys to this document with stability class, description, browser support, and legal notes
5. Write a test in `collectors.test.ts` verifying graceful degradation when the API is absent

The `safeCollect()` method on `BaseCollector` catches any thrown error and returns `{}` — collectors must never propagate errors.
