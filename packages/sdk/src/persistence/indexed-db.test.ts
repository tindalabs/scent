// fake-indexeddb/auto installs a working IndexedDB into the global scope (jsdom
// ships none), letting us exercise the adapter's real open/transaction logic.
// Kept in its own file so the polyfill doesn't leak into the manager tests, where
// we rely on IndexedDB being *absent* (as it is in a real jsdom run).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBAdapter } from './indexed-db.js';

const ID = 'f00dface-0000-4000-8000-000000000001';

describe('IndexedDBAdapter (with fake-indexeddb)', () => {
  beforeEach(async () => {
    await new IndexedDBAdapter().clear();
  });

  it('reports available when indexedDB exists', () => {
    expect(new IndexedDBAdapter().isAvailable()).toBe(true);
  });

  it('round-trips an id through write → read', async () => {
    const a = new IndexedDBAdapter();
    expect(await a.read()).toBeNull();
    await a.write(ID);
    expect(await a.read()).toBe(ID);
  });

  it('clear() removes the stored id', async () => {
    const a = new IndexedDBAdapter();
    await a.write(ID);
    await a.clear();
    expect(await a.read()).toBeNull();
  });

  it('a fresh adapter instance reads a previously persisted id (survives reload)', async () => {
    await new IndexedDBAdapter().write(ID);
    // New instance = new in-memory db handle, same underlying object store.
    expect(await new IndexedDBAdapter().read()).toBe(ID);
  });
});
