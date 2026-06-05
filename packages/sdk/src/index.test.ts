import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScentSDK, init } from './index.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Clear any scent identity cookies left by prior tests
  document.cookie = '__scent_id=; max-age=0; path=/';
});

describe('ScentSDK', () => {
  it('init() returns a ScentSDK instance', () => {
    expect(init({ apiKey: 'test' })).toBeInstanceOf(ScentSDK);
  });

  it('observe() resolves with a ScentObservation', async () => {
    const sdk = init({ apiKey: 'test' });
    const obs = await sdk.observe();
    expect(typeof obs.identity.id).toBe('string');
    expect(obs.identity.id).toHaveLength(36); // UUID
    expect(typeof obs.identity.confidence).toBe('number');
    expect(typeof obs.identity.isNew).toBe('boolean');
  });

  it('first observe() marks identity as new', async () => {
    const sdk = init({ apiKey: 'test' });
    const obs = await sdk.observe();
    expect(obs.identity.isNew).toBe(true);
    expect(obs.identity.continuity).toBe('unknown');
  });

  it('second observe() with same persistence recovers the same identity', async () => {
    const sdk = init({ apiKey: 'test', persistence: 'balanced' });
    const first = await sdk.observe();
    const second = await sdk.observe();
    expect(second.identity.id).toBe(first.identity.id);
    expect(second.identity.isNew).toBe(false);
    expect(second.identity.continuity).toBe('confirmed');
  });

  it('snapshot() returns a flat signal record', async () => {
    const sdk = init({ apiKey: 'test' });
    const signals = await sdk.snapshot();
    expect(typeof signals).toBe('object');
  });

  it('storageHealth() reports available layers', () => {
    const sdk = init({ apiKey: 'test' });
    const health = sdk.storageHealth();
    expect(typeof health).toBe('object');
  });

  it('on() registers a handler and returns an unsubscribe function', async () => {
    const sdk = init({ apiKey: 'test' });
    let fired = false;
    const unsub = sdk.on('identity_resolved', () => {
      fired = true;
    });
    await sdk.observe();
    expect(fired).toBe(true);
    unsub();
  });
});

describe('ScentSDK.identify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops when observe() has not run (no resolved identity)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'test' });
    await sdk.identify('account-123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the account link to /identity/:id/link for the resolved identity', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'secret-key', endpoint: 'https://api.example.test/v1' });
    const obs = await sdk.observe();

    await sdk.identify('account-123');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.example.test/v1/identity/${obs.identity.id}/link`);
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['X-Api-Key']).toBe('secret-key');
    expect(JSON.parse(options.body as string)).toEqual({ accountId: 'account-123' });
  });

  it('sends no account ID in the URL — only in the request body (no PII leak to path)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'test', endpoint: 'https://api.example.test/v1' });
    await sdk.observe();

    await sdk.identify('user@example.com');

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('user@example.com');
    expect(url).toContain('/link');
  });
});
