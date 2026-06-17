import type { PersistencePolicy } from '@tindalabs/scent-engine';
import type { StorageAdapter } from './types.js';
import { CookieAdapter } from './cookie.js';
import { IndexedDBAdapter } from './indexed-db.js';
import { LocalStorageAdapter } from './local-storage.js';
import { SessionStorageAdapter } from './session-storage.js';

// Each policy maps to an ordered list of storage adapters (highest to lowest priority).
// On read, the first layer with a valid value wins.
// On write, all layers in the policy are written simultaneously.
const POLICY_LAYERS: Record<PersistencePolicy, readonly string[]> = {
  conservative: ['cookie'],
  balanced: ['localStorage', 'cookie'],
  aggressive: ['localStorage', 'sessionStorage', 'indexedDB', 'cookie'],
  forensic: ['localStorage', 'sessionStorage', 'indexedDB', 'cookie'],
};

// Default: persistence is forbidden. The SDK injects a real consent check.
const ALWAYS_DENIED = (): boolean => false;

export class PersistenceManager {
  private readonly all: StorageAdapter[];
  private readonly policyNames: readonly string[];
  private readonly isAllowed: () => boolean;

  // `isAllowed` gates writes/reads on consent (ADR-0004). It is checked lazily, so
  // construction performs no device access (the availability probes only run on the
  // first persist/resurrect, after consent is granted).
  constructor(policy: PersistencePolicy, isAllowed: () => boolean = ALWAYS_DENIED) {
    this.all = [
      new LocalStorageAdapter(),
      new SessionStorageAdapter(),
      new IndexedDBAdapter(),
      new CookieAdapter(),
    ];
    this.policyNames = POLICY_LAYERS[policy];
    this.isAllowed = isAllowed;
  }

  // Adapters in the active policy that are available right now. Calling isAvailable()
  // probes the device, so only invoke this past a consent gate (or from clear()).
  private active(): StorageAdapter[] {
    return this.all.filter((a) => this.policyNames.includes(a.name) && a.isAvailable());
  }

  // Returns the first non-null identity ID found across available layers.
  // No-op (null) without consent — reading a stored id is "access to information on
  // the device" under ePrivacy 5(3).
  async resurrect(): Promise<string | null> {
    if (!this.isAllowed()) return null;
    for (const adapter of this.active()) {
      try {
        const id = await adapter.read();
        if (id) return id;
      } catch {
        // layer unavailable at runtime — try next
      }
    }
    return null;
  }

  // Writes the identity ID to all available layers simultaneously. No-op without consent.
  async persist(id: string): Promise<void> {
    if (!this.isAllowed()) return;
    await Promise.allSettled(this.active().map((a) => a.write(id)));
  }

  // Wipes the identity from EVERY layer (not just the active policy — a prior
  // aggressive run may have written layers the current policy omits) and returns the
  // id it found. Consent-independent: erasure is always permitted (right to be forgotten).
  async clear(): Promise<string | null> {
    let found: string | null = null;
    for (const adapter of this.all) {
      if (!adapter.isAvailable()) continue;
      try {
        const id = await adapter.read();
        if (id && !found) found = id;
      } catch {
        // ignore unreadable layers
      }
    }
    await Promise.allSettled(
      this.all.filter((a) => a.isAvailable()).map((a) => a.clear()),
    );
    return found;
  }

  // Reports which storage layers are available in the current session. Reports all
  // false without consent (probing would itself be device access).
  healthCheck(): Record<string, boolean> {
    if (!this.isAllowed()) {
      return Object.fromEntries(
        this.all.filter((a) => this.policyNames.includes(a.name)).map((a) => [a.name, false]),
      );
    }
    return Object.fromEntries(
      this.all.filter((a) => this.policyNames.includes(a.name)).map((a) => [a.name, a.isAvailable()]),
    );
  }
}
