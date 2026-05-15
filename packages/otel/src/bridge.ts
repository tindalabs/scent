import type { ScentSDK, ScentObservation } from '@irregular/scent-sdk';
import { readTraceparent } from './traceparent.js';
import { attachScentAttributes } from './attributes.js';

// A thin wrapper around ScentSDK that automatically:
//   1. Reads the W3C traceparent from the active OTel span at observe() time
//      and injects it into the snapshot so the server can correlate the identity
//      event with the trace that triggered it.
//   2. Attaches scent.identity.* and scent.risk.* span attributes to the active
//      OTel span after the observation resolves.
//
// Usage:
//   const sdk = scent.init({ apiKey: '...', traceparentProvider: readTraceparent });
//   const bridge = new ScentOtelBridge(sdk);
//   const obs = await bridge.observe();  // traceparent injected + span annotated
export class ScentOtelBridge {
  constructor(private readonly sdk: ScentSDK) {}

  async observe(): Promise<ScentObservation> {
    const obs = await this.sdk.observe();
    attachScentAttributes(obs);
    return obs;
  }

  async flush(): Promise<void> {
    return this.sdk.flush();
  }

  snapshot(): Promise<Record<string, string | number | boolean | null>> {
    return this.sdk.snapshot();
  }

  storageHealth(): Record<string, boolean> {
    return this.sdk.storageHealth();
  }
}

export { readTraceparent, attachScentAttributes };
