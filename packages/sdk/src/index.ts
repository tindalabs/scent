export type {
  ScentObservation,
  ScentInitOptions,
  PersistencePolicy,
  SignalMap,
  LawfulBasis,
  ConsentConfig,
} from '@tindalabs/scent-engine';

import type { ScentInitOptions, ScentObservation } from '@tindalabs/scent-engine';
import { buildCollectors, collectAllSignals } from './collectors/index.js';
import { ConsentManager } from './consent/manager.js';
import { ScentEventEmitter, type ScentEventMap } from './events/emitter.js';
import { PersistenceManager } from './persistence/manager.js';

export { buildCollectors, collectAllSignals } from './collectors/index.js';
export type { SignalCollector, SignalRecord, StabilityClass } from './collectors/index.js';
export { PersistenceManager } from './persistence/manager.js';
export { ConsentManager } from './consent/manager.js';
export { ScentEventEmitter } from './events/emitter.js';

// Returned by observe() when consent has not been granted: no signals collected,
// nothing persisted, nothing buffered for transmission. See ADR-0004.
const CLOSED_OBSERVATION: ScentObservation = {
  identity: { id: '', confidence: 0, isNew: false, continuity: 'unknown' },
  drift: { detected: false, delta: [], entropy: 0 },
  risk: { score: 0, flags: [] },
};

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class ScentSDK {
  private readonly options: ScentInitOptions;
  private readonly persistence: PersistenceManager;
  private readonly emitter: ScentEventEmitter;
  private readonly consent: ConsentManager;
  private readonly buffer: Array<Record<string, unknown>> = [];
  private currentIdentityId: string | null = null;

  constructor(options: ScentInitOptions) {
    this.options = options;
    this.consent = new ConsentManager(options.consent);
    // The persistence layer never writes/reads the device unless consent is granted.
    this.persistence = new PersistenceManager(
      options.persistence ?? 'balanced',
      () => this.consent.get(),
    );
    this.emitter = new ScentEventEmitter();
  }

  // Explicitly set consent (the primary path for the default `manual` mode, e.g. after
  // the host application's own CMP/banner resolves). The SDK never renders that UI.
  setConsent(granted: boolean): void {
    this.consent.set(granted);
    this.emitter.emit('consent_changed', { granted, basis: this.options.basis ?? 'consent' });
  }

  getConsent(): boolean {
    return this.consent.get();
  }

  // Right to be forgotten: purges the Scent identity from every local storage layer
  // and clears in-memory state, regardless of consent. Returns the cleared identity id
  // (or null) so the host can also request server-side deletion (DELETE /v1/identity/:id).
  async forget(): Promise<string | null> {
    const id = (await this.persistence.clear()) ?? this.currentIdentityId;
    this.currentIdentityId = null;
    this.buffer.length = 0;
    return id ?? null;
  }

  on<K extends keyof ScentEventMap>(
    event: K,
    handler: Parameters<ScentEventEmitter['on']>[1],
  ): () => void {
    return this.emitter.on(event, handler);
  }

  // Collects all available signals, attempts to recover a prior identity from
  // the persistence layer, and returns an observation. Confidence scoring is
  // local-only in Phase 1 — the probabilistic engine (Phase 2) will replace
  // this with server-resolved scores.
  async observe(opts?: { extraSignals?: Record<string, string | number | boolean | null> }): Promise<ScentObservation> {
    // Privacy-by-default gate (ADR-0004): no collection, persistence, or transmission
    // until consent is granted. Re-read the source each call so revocation takes effect.
    await this.consent.refresh();
    if (!this.consent.get()) return CLOSED_OBSERVATION;

    const collectors = buildCollectors(this.options);
    const [collectedSignals, resurrectedId] = await Promise.all([
      collectAllSignals(collectors),
      this.persistence.resurrect(),
    ]);
    const signals = opts?.extraSignals ? { ...collectedSignals, ...opts.extraSignals } : collectedSignals;

    const isNew = resurrectedId === null;
    const id = resurrectedId ?? generateId();
    this.currentIdentityId = id;

    if (isNew) {
      await this.persistence.persist(id);
    }

    const observation: ScentObservation = {
      identity: {
        id,
        // Phase 1: binary confidence — either we recovered the same ID (1.0)
        // or this is a brand-new identity (0.0). Phase 2 makes this probabilistic.
        confidence: isNew ? 0 : 1,
        isNew,
        continuity: isNew ? 'unknown' : 'confirmed',
      },
      drift: {
        // Phase 2 computes real drift by comparing against the previous snapshot
        detected: false,
        delta: [],
        entropy: 0,
      },
      risk: {
        // Phase 3 computes real risk scores
        score: 0,
        flags: [],
      },
    };

    this.emitter.emit('identity_resolved', observation);

    const traceparent = this.options.traceparentProvider?.() ?? undefined;

    // Buffer the snapshot payload for flush() transport to the server. Carries the
    // consent provenance (lawful basis, policy version, grant time) so the server can
    // record under what basis each snapshot was collected (GDPR Art. 7(1)).
    const consentedAt = this.consent.consentedAt();
    this.buffer.push({
      identityId: id,
      signals,
      persistencePolicy: this.options.persistence ?? 'balanced',
      timestamp: new Date().toISOString(),
      lawfulBasis: this.options.basis ?? 'consent',
      ...(this.options.consentVersion ? { consentVersion: this.options.consentVersion } : {}),
      ...(consentedAt ? { consentedAt } : {}),
      ...(traceparent !== undefined ? { traceparent } : {}),
    });

    // Expose merged signals on the observation for debugging and server transport
    (observation as ScentObservation & { _signals: typeof signals })._signals = signals;

    return observation;
  }

  // Sends all buffered snapshot payloads to the configured server endpoint.
  // Safe to call repeatedly — no-ops when the buffer is empty.
  // The server endpoint (POST /v1/events) is implemented in Phase 2;
  // flush() will resolve immediately with a 501 until then.
  async flush(): Promise<void> {
    if (!this.consent.get()) return;
    if (this.buffer.length === 0) return;
    const endpoint = this.options.endpoint ?? 'https://api.tindalabs.dev/v1';
    const payload = [...this.buffer];
    this.buffer.length = 0;

    await fetch(`${endpoint}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.options.apiKey,
      },
      body: JSON.stringify({ snapshots: payload }),
    });
  }

  // Links the current Scent identity to an application-level account ID (e.g. a
  // user's primary key after login or signup). This is what enables "how many
  // accounts share this device?" queries via GET /v1/account/:id/identities.
  // No-op if observe() has not been called yet in this session.
  async identify(accountId: string): Promise<void> {
    if (!this.consent.get()) return;
    if (!this.currentIdentityId) return;
    const endpoint = this.options.endpoint ?? 'https://api.tindalabs.dev/v1';
    await fetch(`${endpoint}/identity/${this.currentIdentityId}/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.options.apiKey,
      },
      body: JSON.stringify({ accountId }),
    });
  }

  // Captures the current signal state without resolving or persisting identity.
  // Gated on consent: reading canvas/audio/etc. is itself device access (ePrivacy 5(3)).
  async snapshot(): Promise<Record<string, string | number | boolean | null>> {
    await this.consent.refresh();
    if (!this.consent.get()) return {};
    const collectors = buildCollectors(this.options);
    return collectAllSignals(collectors);
  }

  storageHealth(): Record<string, boolean> {
    return this.persistence.healthCheck();
  }
}

export function init(options: ScentInitOptions): ScentSDK {
  return new ScentSDK(options);
}
