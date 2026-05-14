// Core domain types for the Scent identity engine.
// These are the canonical data shapes shared across packages/server and packages/sdk.

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';
export type RiskBand = 'critical' | 'high' | 'medium' | 'low';
export type DriftClassification = 'minor' | 'moderate' | 'significant' | 'suspicious';
export type IdentityContinuity = 'confirmed' | 'probable' | 'uncertain' | 'unknown';
export type PersistencePolicy = 'conservative' | 'balanced' | 'aggressive' | 'forensic';
export type SignalMap = Record<string, string | number | boolean | null>;

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
  traceparent?: string; // W3C OTel traceparent, present when @blindspot/web is active
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
  endpoint?: string; // defaults to https://api.irregular.dev/v1
  persistence?: PersistencePolicy; // defaults to 'balanced'
  signals?: {
    webrtc?: boolean; // opt-in, invasive
    battery?: boolean; // opt-in, invasive, platform-restricted
  };
}
