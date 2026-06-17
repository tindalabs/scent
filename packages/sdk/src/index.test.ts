import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScentSDK, init } from './index.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Clear any scent identity cookies left by prior tests
  document.cookie = '__scent_id=; max-age=0; path=/';
});

// Privacy-by-default (ADR-0004): the SDK collects/persists/transmits nothing until
// consent is granted. Most behavioural tests below grant consent up front; the
// "consent gate" block exercises the closed (default) state.
function consented(options: Parameters<typeof init>[0]): ScentSDK {
  const sdk = init(options);
  sdk.setConsent(true);
  return sdk;
}

describe('ScentSDK', () => {
  it('init() returns a ScentSDK instance', () => {
    expect(init({ apiKey: 'test' })).toBeInstanceOf(ScentSDK);
  });

  it('observe() resolves with a ScentObservation', async () => {
    const sdk = consented({ apiKey: 'test' });
    const obs = await sdk.observe();
    expect(typeof obs.identity.id).toBe('string');
    expect(obs.identity.id).toHaveLength(36); // UUID
    expect(typeof obs.identity.confidence).toBe('number');
    expect(typeof obs.identity.isNew).toBe('boolean');
  });

  it('first observe() marks identity as new', async () => {
    const sdk = consented({ apiKey: 'test' });
    const obs = await sdk.observe();
    expect(obs.identity.isNew).toBe(true);
    expect(obs.identity.continuity).toBe('unknown');
  });

  it('second observe() with same persistence recovers the same identity', async () => {
    const sdk = consented({ apiKey: 'test', persistence: 'balanced' });
    const first = await sdk.observe();
    const second = await sdk.observe();
    expect(second.identity.id).toBe(first.identity.id);
    expect(second.identity.isNew).toBe(false);
    expect(second.identity.continuity).toBe('confirmed');
  });

  it('snapshot() returns a flat signal record', async () => {
    const sdk = consented({ apiKey: 'test' });
    const signals = await sdk.snapshot();
    expect(typeof signals).toBe('object');
  });

  it('storageHealth() reports available layers', () => {
    const sdk = consented({ apiKey: 'test' });
    const health = sdk.storageHealth();
    expect(typeof health).toBe('object');
  });

  it('on() registers a handler and returns an unsubscribe function', async () => {
    const sdk = consented({ apiKey: 'test' });
    let fired = false;
    const unsub = sdk.on('identity_resolved', () => {
      fired = true;
    });
    await sdk.observe();
    expect(fired).toBe(true);
    unsub();
  });
});

describe('ScentSDK consent gate (ADR-0004 privacy-by-default)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is closed by default: observe() collects/persists/buffers nothing', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'test' }); // no consent granted

    const obs = await sdk.observe();

    expect(sdk.getConsent()).toBe(false);
    expect(obs.identity.id).toBe(''); // no identity resolved
    expect(localStorage.getItem('__scent_id')).toBeNull(); // nothing persisted
    await sdk.flush();
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing transmitted
  });

  it('snapshot() returns an empty record when closed', async () => {
    const sdk = init({ apiKey: 'test' });
    expect(await sdk.snapshot()).toEqual({});
  });

  it('collects and persists once consent is granted', async () => {
    const sdk = init({ apiKey: 'test', persistence: 'balanced' });
    sdk.setConsent(true);
    const obs = await sdk.observe();
    expect(obs.identity.id).toHaveLength(36);
    expect(localStorage.getItem('__scent_id')).toBe(obs.identity.id);
  });

  it('emits consent_changed on setConsent()', () => {
    const sdk = init({ apiKey: 'test', basis: 'legitimate_interest' });
    const events: Array<{ granted: boolean; basis: string }> = [];
    sdk.on('consent_changed', (e) => events.push(e));
    sdk.setConsent(true);
    sdk.setConsent(false);
    expect(events).toEqual([
      { granted: true, basis: 'legitimate_interest' },
      { granted: false, basis: 'legitimate_interest' },
    ]);
  });

  it("callback mode gates on the host's resolver", async () => {
    let allow = false;
    const sdk = init({ apiKey: 'test', consent: { mode: 'callback', resolve: () => allow } });
    expect((await sdk.observe()).identity.id).toBe(''); // resolver says no
    allow = true;
    expect((await sdk.observe()).identity.id).toHaveLength(36); // resolver flips
  });

  it('forget() clears every storage layer and returns the prior id', async () => {
    const sdk = init({ apiKey: 'test', persistence: 'aggressive' });
    sdk.setConsent(true);
    const obs = await sdk.observe();
    expect(localStorage.getItem('__scent_id')).toBe(obs.identity.id);

    const cleared = await sdk.forget();
    expect(cleared).toBe(obs.identity.id);
    expect(localStorage.getItem('__scent_id')).toBeNull();
    expect(sessionStorage.getItem('__scent_id')).toBeNull();
  });
});

describe('ScentSDK.identify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops when observe() has not run (no resolved identity)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = consented({ apiKey: 'test' });
    await sdk.identify('account-123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no-ops when consent has not been granted', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'test' }); // no consent
    await sdk.observe();
    await sdk.identify('account-123');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the account link to /identity/:id/link for the resolved identity', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = consented({ apiKey: 'secret-key', endpoint: 'https://api.example.test/v1' });
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
    const sdk = consented({ apiKey: 'test', endpoint: 'https://api.example.test/v1' });
    await sdk.observe();

    await sdk.identify('user@example.com');

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('user@example.com');
    expect(url).toContain('/link');
  });
});

describe('ScentSDK.flush consent provenance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards lawful basis and consent version on each snapshot', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({
      apiKey: 'test',
      endpoint: 'https://api.example.test/v1',
      basis: 'legitimate_interest',
      consentVersion: 'policy-v3',
    });
    sdk.setConsent(true);
    await sdk.observe();
    await sdk.flush();

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/events');
    const body = JSON.parse(options.body as string) as { snapshots: Array<Record<string, unknown>> };
    expect(body.snapshots[0]).toMatchObject({
      lawfulBasis: 'legitimate_interest',
      consentVersion: 'policy-v3',
    });
    expect(typeof body.snapshots[0]!['consentedAt']).toBe('string');
  });

  it("defaults lawful basis to 'consent'", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sdk = init({ apiKey: 'test', endpoint: 'https://api.example.test/v1' });
    sdk.setConsent(true);
    await sdk.observe();
    await sdk.flush();
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      snapshots: Array<Record<string, unknown>>;
    };
    expect(body.snapshots[0]!['lawfulBasis']).toBe('consent');
  });
});
