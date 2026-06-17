// Core domain types for the Scent identity engine.
// These are the canonical data shapes shared across packages/server and packages/sdk.

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';
export type RiskBand = 'critical' | 'high' | 'medium' | 'low';
export type DriftClassification = 'minor' | 'moderate' | 'significant' | 'suspicious';
export type IdentityContinuity = 'confirmed' | 'probable' | 'uncertain' | 'unknown';
export type PersistencePolicy = 'conservative' | 'balanced' | 'aggressive' | 'forensic';
export type SignalMap = Record<string, string | number | boolean | null>;

/**
 * The GDPR lawful basis the controller (the embedding application) asserts for
 * collecting and processing signals. The SDK does not adjudicate legality — it
 * records and forwards whatever the controller declares. See ADR-0004.
 */
export type LawfulBasis = 'consent' | 'legitimate_interest' | 'strictly_necessary';

/**
 * How the SDK learns whether the data subject has consented. The SDK enforces
 * the gate (privacy-by-default, fail-closed) but never renders UI — triggering
 * consent is the controller's job, via their existing CMP. See ADR-0004.
 *
 * - `manual`   — closed until `sdk.setConsent(true)` is called (default).
 * - `callback` — the SDK calls `resolve()` (sync or async) to read consent.
 * - `tcf`      — read IAB TCF v2 (`window.__tcfapi`).
 * - `gcm`      — read Google Consent Mode (`window.dataLayer` / `gtag`).
 */
export interface ConsentConfig {
  mode?: 'manual' | 'callback' | 'tcf' | 'gcm';
  /** For `mode: 'callback'`: returns the current consent state. */
  resolve?: () => boolean | Promise<boolean>;
  /** Initial state for `manual` mode before `setConsent()`. Default `false` (fail-closed). */
  initial?: boolean;
}

/**
 * A persistent entity record. One ScentIdentity per real-world entity,
 * surviving across sessions, storage resets, and moderate signal drift.
 */
export interface ScentIdentity {
  id: string;
  firstSeen: Date;
  lastSeen: Date;
  confidenceBand: ConfidenceBand;
  riskBand: RiskBand;
  snapshotCount: number;
  clusterId?: string; // set when linked to a coordinated-behavior cluster
}

/**
 * A point-in-time signal collection from a browser session.
 * Every call to sdk.observe() produces one snapshot.
 */
export interface ScentSnapshot {
  id: string;
  identityId: string;
  timestamp: Date;
  signals: SignalMap;
  signalHash: string; // SimHash of the stable-signal subset
  persistencePolicy: PersistencePolicy;
  traceparent?: string; // W3C OTel traceparent, present when @tindalabs/blindspot is active
}

/**
 * A delta between two consecutive snapshots for the same identity.
 * Populated by the identity engine after each new snapshot is matched.
 */
export interface ScentDrift {
  id: string;
  identityId: string;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  timestamp: Date;
  classification: DriftClassification;
  entropy: number; // 0–1 magnitude; higher = more changed
  changedSignals: string[];
  addedSignals: string[];
  removedSignals: string[];
}

/**
 * A risk assessment record produced by the risk engine for a given snapshot.
 */
export interface ScentRisk {
  id: string;
  identityId: string;
  snapshotId: string;
  timestamp: Date;
  score: number; // 0–1 composite score
  band: RiskBand;
  flags: RiskFlag[];
}

export interface RiskFlag {
  code: string; // machine-readable, e.g. "automation_suspected"
  label: string; // short human label, e.g. "Automation detected"
  reason: string; // explanation, e.g. "navigator.webdriver was true"
  confidence: number; // 0–1
}

/**
 * The object returned by sdk.observe() — the public API surface of the SDK.
 * Populated by the server after resolving the snapshot against the identity engine.
 */
export interface ScentObservation {
  identity: {
    id: string;
    confidence: number; // 0–1
    isNew: boolean;
    continuity: IdentityContinuity;
  };
  drift: {
    detected: boolean;
    delta: string[]; // names of signals that changed
    entropy: number; // 0–1
  };
  risk: {
    score: number; // 0–1
    flags: string[]; // RiskFlag codes
  };
}

/**
 * SDK initialisation options.
 */
export interface ScentInitOptions {
  apiKey: string;
  endpoint?: string; // defaults to https://api.tindalabs.dev/v1
  persistence?: PersistencePolicy; // defaults to 'balanced'
  signals?: {
    webrtc?: boolean; // opt-in, invasive
    battery?: boolean; // opt-in, invasive, platform-restricted
  };
  // Privacy-by-default consent gate (ADR-0004). Collection, persistence, and
  // transmission are OFF until consent is granted. Omitted = `{ mode: 'manual' }`,
  // i.e. closed until setConsent(true). The SDK never renders consent UI.
  consent?: ConsentConfig;
  // The lawful basis the controller asserts; recorded on every snapshot. Default 'consent'.
  basis?: LawfulBasis;
  // The controller's consent-policy version, forwarded to the server for accountability.
  consentVersion?: string;
  // Called at observe() time to inject the W3C traceparent for the current trace.
  // Wire to @tindalabs/scent-otel's readTraceparent() for automatic OTel bridge.
  traceparentProvider?: () => string | null;
}
