import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConsentManager } from './manager.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConsentManager', () => {
  it('is closed by default (manual mode, fail-closed)', async () => {
    const m = new ConsentManager();
    expect(m.get()).toBe(false);
    expect(await m.refresh()).toBe(false);
    expect(m.consentedAt()).toBeNull();
  });

  it('manual: initial:true opens it and stamps consentedAt', () => {
    const m = new ConsentManager({ mode: 'manual', initial: true });
    expect(m.get()).toBe(true);
    expect(typeof m.consentedAt()).toBe('string');
  });

  it('set(true)/set(false) toggles and clears the timestamp on revoke', () => {
    const m = new ConsentManager();
    m.set(true);
    expect(m.get()).toBe(true);
    const at = m.consentedAt();
    expect(at).not.toBeNull();
    m.set(false);
    expect(m.get()).toBe(false);
    expect(m.consentedAt()).toBeNull();
  });

  it('callback mode re-reads the resolver on refresh', async () => {
    let allow = false;
    const m = new ConsentManager({ mode: 'callback', resolve: () => allow });
    expect(await m.refresh()).toBe(false);
    allow = true;
    expect(await m.refresh()).toBe(true);
  });

  it('callback mode supports async resolvers', async () => {
    const m = new ConsentManager({ mode: 'callback', resolve: async () => true });
    expect(await m.refresh()).toBe(true);
  });

  it('callback mode with no resolver is fail-closed', async () => {
    const m = new ConsentManager({ mode: 'callback' });
    expect(await m.refresh()).toBe(false);
  });

  it('tcf: grants when Purpose 1 consent is present', async () => {
    vi.stubGlobal('__tcfapi', (cmd: string, _v: number, cb: (d: unknown, ok: boolean) => void) => {
      if (cmd === 'getTCData') cb({ gdprApplies: true, purpose: { consents: { '1': true } } }, true);
    });
    const m = new ConsentManager({ mode: 'tcf' });
    expect(await m.refresh()).toBe(true);
  });

  it('tcf: denies when Purpose 1 consent is absent', async () => {
    vi.stubGlobal('__tcfapi', (cmd: string, _v: number, cb: (d: unknown, ok: boolean) => void) => {
      if (cmd === 'getTCData') cb({ gdprApplies: true, purpose: { consents: { '1': false } } }, true);
    });
    const m = new ConsentManager({ mode: 'tcf' });
    expect(await m.refresh()).toBe(false);
  });

  it('tcf: grants when GDPR does not apply', async () => {
    vi.stubGlobal('__tcfapi', (cmd: string, _v: number, cb: (d: unknown, ok: boolean) => void) => {
      if (cmd === 'getTCData') cb({ gdprApplies: false }, true);
    });
    const m = new ConsentManager({ mode: 'tcf' });
    expect(await m.refresh()).toBe(true);
  });

  it('tcf: fail-closed when no CMP is present', async () => {
    const m = new ConsentManager({ mode: 'tcf' });
    expect(await m.refresh()).toBe(false);
  });

  it('gcm: grants when analytics_storage is granted', async () => {
    vi.stubGlobal('dataLayer', [['consent', 'default', { analytics_storage: 'denied' }], ['consent', 'update', { analytics_storage: 'granted' }]]);
    const m = new ConsentManager({ mode: 'gcm' });
    expect(await m.refresh()).toBe(true);
  });

  it('gcm: latest state wins (granted then denied = denied)', async () => {
    vi.stubGlobal('dataLayer', [['consent', 'update', { analytics_storage: 'granted' }], ['consent', 'update', { analytics_storage: 'denied' }]]);
    const m = new ConsentManager({ mode: 'gcm' });
    expect(await m.refresh()).toBe(false);
  });

  it('gcm: fail-closed when no dataLayer is present', async () => {
    const m = new ConsentManager({ mode: 'gcm' });
    expect(await m.refresh()).toBe(false);
  });
});
