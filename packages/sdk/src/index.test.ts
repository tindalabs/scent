import { describe, it, expect } from 'vitest';
import { ScentSDK, init } from './index.js';

describe('@irregular/scent-sdk', () => {
  it('init() returns a ScentSDK instance', () => {
    const sdk = init({ apiKey: 'test-key' });
    expect(sdk).toBeInstanceOf(ScentSDK);
  });

  it('observe() rejects until Phase 1 is implemented', async () => {
    const sdk = init({ apiKey: 'test-key' });
    await expect(sdk.observe()).rejects.toThrow('Not implemented');
  });
});
