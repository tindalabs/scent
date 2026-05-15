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

export class PersistenceManager {
  private readonly adapters: StorageAdapter[];

  constructor(policy: PersistencePolicy) {
    const all: StorageAdapter[] = [
      new LocalStorageAdapter(),
      new SessionStorageAdapter(),
      new IndexedDBAdapter(),
      new CookieAdapter(),
    ];

    const names = POLICY_LAYERS[policy];
    this.adapters = all.filter(
      (a) => names.includes(a.name) && a.isAvailable(),
    );
  }

  // Returns the first non-null identity ID found across available layers.
  async resurrect(): Promise<string | null> {
    for (const adapter of this.adapters) {
      try {
        const id = await adapter.read();
        if (id) return id;
      } catch {
        // layer unavailable at runtime — try next
      }
    }
    return null;
  }

  // Writes the identity ID to all available layers simultaneously.
  async persist(id: string): Promise<void> {
    await Promise.allSettled(this.adapters.map((a) => a.write(id)));
  }

  // Reports which storage layers are available in the current session.
  healthCheck(): Record<string, boolean> {
    return Object.fromEntries(this.adapters.map((a) => [a.name, a.isAvailable()]));
  }
}
