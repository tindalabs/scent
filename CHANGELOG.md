# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-05-20

### Added
- Initial release of `@tindalabs/scent-sdk`, `@tindalabs/scent-engine`, and `@tindalabs/scent-server`.
- `init(options)` + `observe()` for browser fingerprint collection and identity resolution.
- `identify(accountId)` to link a resolved identity to an application-level account ID.
- `flush()` to force-send buffered snapshots before page unload.
- Configurable `persistence` modes: `aggressive`, `balanced` (default), `conservative`.
- Drift detection with per-signal entropy scoring.
- Risk assessment with configurable flag rules and `confidence_band` / `risk_band` output.
- 18 signal collectors: canvas, audio, font, screen, locale, hardware, platform, touch, network, plugin, media, WebDriver, headless, patched API, DevTools, entropy spoof, WebRTC, storage mode.
- REST API server with routes for `/v1/events`, `/v1/identity`, `/v1/identities`, `/v1/resolve`, `/v1/clusters`, `/v1/account`, `/v1/dashboard`.
- OpenTelemetry instrumentation via `node --import` pre-loading; custom spans for identity resolution, risk assessment, and account linking.
- PostgreSQL-backed storage with versioned SQL migrations.
- Redis-backed rate limiting.
