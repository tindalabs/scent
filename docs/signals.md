# Signal Reference

This document is the authoritative reference for every signal Scent collects. It is intended for three audiences: engineers integrating the SDK, DPOs and legal counsel auditing data collection, and AI agents working on the codebase.

Signal collection and signal persistence are **separate concerns**. Every signal listed here is collected on every `observe()` call regardless of the active `PersistencePolicy`. The policy controls only what is written to browser storage and transported to the server — see [Persistence Policies](#persistence-policies) below.

---

## Stability classes

Each signal is assigned a stability class that informs the server-side identity engine's weighting model (Phase 2). A signal that changes often contributes less to identity continuity than one that is rock-solid across sessions.

| Class | Meaning | Decay rate | Examples |
|---|---|---|---|
| `stable` | Rarely or never changes for a real user on the same device | Low | Canvas hash, audio hash, font list, hardware concurrency |
| `moderate` | Changes infrequently — browser updates, OS upgrades, user preference changes | Medium | Screen resolution, locale, plugins, CSS media preferences |
| `volatile` | Can change every session | High | Network type, IP-derived signals, anti-tamper flags |

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

**Notes:** Anti-fingerprinting browser extensions (LibreWolf, Brave Shields, canvas-fingerprint-defender) commonly patch these methods to return randomised output. A patched API means canvas and WebGL signals from this session should be down-weighted in matching. This is a critical input to the signal weighting model in Phase 2.

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

**Notes:** When `true`, `canvas.2d` from this session is unreliable for identity matching and should be excluded from the SimHash input. The identity engine must check this flag before using canvas signals in Phase 2.

---

## Deferred opt-in signals

These signals are architecturally supported (the `buildCollectors()` factory checks `options.signals.*`) but not yet implemented. They require explicit opt-in because of their invasiveness.

| Signal group | Gate | Planned keys | Reason for opt-in |
|---|---|---|---|
| WebRTC local IP | `options.signals.webrtc: true` | `webrtc.local_ip`, `webrtc.public_ip` | Exposes local network topology; legally sensitive in many jurisdictions |
| Battery API | `options.signals.battery: true` | `battery.level`, `battery.charging` | Highly invasive; removed from Firefox and Safari; deprecated in Chrome |

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
