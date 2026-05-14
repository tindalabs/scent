import { describe, it, expect, beforeEach } from 'vitest';
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
