export type {
  ScentObservation,
  ScentInitOptions,
  PersistencePolicy,
  SignalMap,
} from '@irregular/scent-engine';

import type { ScentInitOptions, ScentObservation } from '@irregular/scent-engine';
import { buildCollectors, collectAllSignals } from './collectors/index.js';
import { ScentEventEmitter, type ScentEventMap } from './events/emitter.js';
import { PersistenceManager } from './persistence/manager.js';

export { buildCollectors, collectAllSignals } from './collectors/index.js';
export type { SignalCollector, SignalRecord, StabilityClass } from './collectors/index.js';
export { PersistenceManager } from './persistence/manager.js';
export { ScentEventEmitter } from './events/emitter.js';

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
  private readonly buffer: Array<Record<string, unknown>> = [];

  constructor(options: ScentInitOptions) {
    this.options = options;
    this.persistence = new PersistenceManager(options.persistence ?? 'balanced');
    this.emitter = new ScentEventEmitter();
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
  async observe(): Promise<ScentObservation> {
    const collectors = buildCollectors(this.options);
    const [signals, resurrectedId] = await Promise.all([
      collectAllSignals(collectors),
      this.persistence.resurrect(),
    ]);

    const isNew = resurrectedId === null;
    const id = resurrectedId ?? generateId();

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

    // Buffer the snapshot payload for flush() transport to the server
    this.buffer.push({
      identityId: id,
      signals,
      persistencePolicy: this.options.persistence ?? 'balanced',
      timestamp: new Date().toISOString(),
    });

    // Expose raw signals on the observation for debugging and server transport
    (observation as ScentObservation & { _signals: typeof signals })._signals = signals;

    return observation;
  }

  // Sends all buffered snapshot payloads to the configured server endpoint.
  // Safe to call repeatedly — no-ops when the buffer is empty.
  // The server endpoint (POST /v1/events) is implemented in Phase 2;
  // flush() will resolve immediately with a 501 until then.
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const endpoint = this.options.endpoint ?? 'https://api.irregular.dev/v1';
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

  // Captures the current signal state without resolving or persisting identity.
  async snapshot(): Promise<Record<string, string | number | boolean | null>> {
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
