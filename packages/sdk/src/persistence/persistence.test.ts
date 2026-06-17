import { describe, it, expect, beforeEach } from 'vitest';
import { CookieAdapter } from './cookie.js';
import { LocalStorageAdapter } from './local-storage.js';
import { SessionStorageAdapter } from './session-storage.js';
import { PersistenceManager } from './manager.js';

const ID = 'a1b2c3d4-0000-4000-8000-000000000000';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = '__scent_id=; max-age=0; path=/';
});

describe('CookieAdapter', () => {
  const c = new CookieAdapter();

  it('is available when cookies are enabled (jsdom)', () => {
    expect(c.isAvailable()).toBe(true);
  });

  it('round-trips an id through write → read', async () => {
    await c.write(ID);
    expect(await c.read()).toBe(ID);
  });

  it('reads null when no cookie is set', async () => {
    expect(await c.read()).toBeNull();
  });

  it('clear() removes the cookie', async () => {
    await c.write(ID);
    await c.clear();
    expect(await c.read()).toBeNull();
  });
});

describe('LocalStorageAdapter', () => {
  const ls = new LocalStorageAdapter();

  it('is available in jsdom', () => {
    expect(ls.isAvailable()).toBe(true);
  });

  it('round-trips and clears', async () => {
    expect(await ls.read()).toBeNull();
    await ls.write(ID);
    expect(await ls.read()).toBe(ID);
    await ls.clear();
    expect(await ls.read()).toBeNull();
  });

  it('does not leak the id under an unexpected key', async () => {
    await ls.write(ID);
    expect(localStorage.getItem('__scent_id')).toBe(ID);
  });
});

describe('SessionStorageAdapter', () => {
  const ss = new SessionStorageAdapter();

  it('is available in jsdom', () => {
    expect(ss.isAvailable()).toBe(true);
  });

  it('round-trips and clears', async () => {
    await ss.write(ID);
    expect(await ss.read()).toBe(ID);
    await ss.clear();
    expect(await ss.read()).toBeNull();
  });
});

describe('PersistenceManager', () => {
  it("balanced policy uses localStorage + cookie (indexedDB unavailable in jsdom)", () => {
    const m = new PersistenceManager('balanced', () => true);
    const health = m.healthCheck();
    expect(health['localStorage']).toBe(true);
    expect(health['cookie']).toBe(true);
    expect('indexedDB' in health).toBe(false); // filtered out — not available in jsdom
  });

  it('without a consent check, persist/resurrect are no-ops (fail-closed default)', async () => {
    const m = new PersistenceManager('balanced'); // no isAllowed → denied
    await m.persist(ID);
    expect(localStorage.getItem('__scent_id')).toBeNull();
    expect(await m.resurrect()).toBeNull();
  });

  it('conservative policy persists only to the cookie layer', async () => {
    const m = new PersistenceManager('conservative', () => true);
    await m.persist(ID);
    expect(localStorage.getItem('__scent_id')).toBeNull();
    expect(document.cookie).toContain(`__scent_id=${ID}`);
  });

  it('resurrect() returns null when nothing has been stored', async () => {
    const m = new PersistenceManager('balanced', () => true);
    expect(await m.resurrect()).toBeNull();
  });

  it('persist() writes the id to every layer in the policy', async () => {
    const m = new PersistenceManager('balanced', () => true);
    await m.persist(ID);
    expect(localStorage.getItem('__scent_id')).toBe(ID);
    expect(document.cookie).toContain(`__scent_id=${ID}`);
    expect(await m.resurrect()).toBe(ID);
  });

  // The core resilience property: a returning visitor survives one storage layer
  // being wiped, because the manager resurrects from any surviving layer.
  it('resurrects from the cookie after localStorage is cleared (storage amnesia)', async () => {
    const m = new PersistenceManager('balanced', () => true);
    await m.persist(ID);

    localStorage.clear(); // simulate a partial wipe / cleared site data for one layer

    expect(localStorage.getItem('__scent_id')).toBeNull();
    expect(await m.resurrect()).toBe(ID); // recovered from the cookie layer
  });
});
