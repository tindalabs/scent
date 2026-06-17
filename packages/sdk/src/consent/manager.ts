import type { ConsentConfig } from '@tindalabs/scent-engine';

// Reads IAB TCF v2 consent. We treat "consent granted" as: a CMP is present and the
// user has given consent for the relevant purpose set. Conservatively fail-closed:
// any error, missing API, or non-affirmative state resolves to false.
function readTcf(): Promise<boolean> {
  const api = (globalThis as unknown as { __tcfapi?: (...args: unknown[]) => void }).__tcfapi;
  if (typeof api !== 'function') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    try {
      api('getTCData', 2, (tcData: unknown, success: boolean) => {
        if (!success || !tcData || typeof tcData !== 'object') return resolve(false);
        const d = tcData as { gdprApplies?: boolean; purpose?: { consents?: Record<string, boolean> } };
        // If GDPR doesn't apply, there's nothing to gate. Otherwise require Purpose 1
        // (store/access information on a device) — the ePrivacy 5(3) purpose.
        if (d.gdprApplies === false) return resolve(true);
        resolve(Boolean(d.purpose?.consents?.['1']));
      });
    } catch {
      resolve(false);
    }
  });
}

// Reads Google Consent Mode. Granted when the most recent consent state sets
// `analytics_storage` (or `ad_storage`) to 'granted'. Fail-closed on absence.
function readGcm(): boolean {
  const dl = (globalThis as unknown as { dataLayer?: unknown[] }).dataLayer;
  if (!Array.isArray(dl)) return false;
  let granted = false;
  for (const entry of dl) {
    // gtag('consent', 'default'|'update', { analytics_storage: 'granted', ... })
    if (Array.isArray(entry) && entry[0] === 'consent' && entry[2] && typeof entry[2] === 'object') {
      const cfg = entry[2] as Record<string, unknown>;
      const v = cfg['analytics_storage'] ?? cfg['ad_storage'];
      if (v === 'granted') granted = true;
      else if (v === 'denied') granted = false;
    }
  }
  return granted;
}

/**
 * Holds the SDK's consent state and re-reads it from the configured source.
 * Privacy-by-default: state starts closed (false) for every mode except an
 * explicit `manual` `initial: true`. The SDK gates all collection, persistence,
 * and transmission on `get()`. See ADR-0004.
 */
export class ConsentManager {
  private granted: boolean;
  private grantedAtIso: string | null = null;
  private readonly mode: NonNullable<ConsentConfig['mode']>;
  private readonly resolver: ConsentConfig['resolve'];

  constructor(config?: ConsentConfig) {
    this.mode = config?.mode ?? 'manual';
    this.resolver = config?.resolve;
    const initial = this.mode === 'manual' ? Boolean(config?.initial) : false;
    this.granted = initial;
    if (initial) this.grantedAtIso = new Date().toISOString();
  }

  get(): boolean {
    return this.granted;
  }

  // Records when consent was first granted (for snapshot provenance). Null while closed.
  consentedAt(): string | null {
    return this.granted ? this.grantedAtIso : null;
  }

  // Explicit override (the primary path for `manual` mode, e.g. after the host's
  // own consent banner resolves). Updates the grant timestamp on a false→true edge.
  set(granted: boolean): void {
    this.applyState(granted);
  }

  // Re-reads consent from the external source (callback/tcf/gcm). For `manual`
  // mode this is a no-op that returns the cached state.
  async refresh(): Promise<boolean> {
    switch (this.mode) {
      case 'callback':
        this.applyState(this.resolver ? Boolean(await this.resolver()) : false);
        break;
      case 'tcf':
        this.applyState(await readTcf());
        break;
      case 'gcm':
        this.applyState(readGcm());
        break;
      case 'manual':
        break; // cached state is authoritative
    }
    return this.granted;
  }

  private applyState(granted: boolean): void {
    if (granted && !this.granted) this.grantedAtIso = new Date().toISOString();
    if (!granted) this.grantedAtIso = null;
    this.granted = granted;
  }
}
