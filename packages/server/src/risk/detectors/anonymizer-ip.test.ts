import { describe, it, expect } from 'vitest';
import { detectAnonymizerIp } from './anonymizer-ip.js';
import type { AnonymizerInfo, AsnInfo } from '../ip-intel.js';

const NONE: AnonymizerInfo = {
  hosting: false,
  vpn: false,
  tor: false,
  publicProxy: false,
  residentialProxy: false,
  anonymous: false,
};

const anon = (over: Partial<AnonymizerInfo>) => (): Promise<AnonymizerInfo | null> =>
  Promise.resolve({ ...NONE, ...over });
const noAnon = (): Promise<AnonymizerInfo | null> => Promise.resolve(null);
const noAsn = (): Promise<AsnInfo | null> => Promise.resolve(null);

describe('detectAnonymizerIp', () => {
  it('returns null without a client IP', async () => {
    expect(await detectAnonymizerIp(null, anon({ hosting: true }), noAsn)).toBeNull();
  });

  it('returns null when the anonymizer DB is disabled / IP not flagged', async () => {
    expect(await detectAnonymizerIp('8.8.8.8', noAnon, noAsn)).toBeNull();
  });

  it('returns null when a record exists but no network-type flag is set', async () => {
    expect(await detectAnonymizerIp('8.8.8.8', anon({}), noAsn)).toBeNull();
  });

  it('flags a hosting/datacenter IP', async () => {
    const flag = await detectAnonymizerIp('8.8.8.8', anon({ hosting: true }), noAsn);
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('anonymizer_ip');
    expect(flag!.confidence).toBeCloseTo(0.62);
    expect(flag!.reason).toContain('hosting/datacenter');
  });

  it('picks the strongest network type when several are set (Tor > hosting)', async () => {
    const flag = await detectAnonymizerIp('8.8.8.8', anon({ hosting: true, tor: true }), noAsn);
    expect(flag!.confidence).toBeCloseTo(0.85);
    expect(flag!.reason).toContain('Tor exit node');
  });

  it('enriches the reason with ASN org when available', async () => {
    const asn = (): Promise<AsnInfo | null> => Promise.resolve({ asn: 15169, org: 'Google LLC' });
    const flag = await detectAnonymizerIp('8.8.8.8', anon({ hosting: true }), asn);
    expect(flag!.reason).toContain('AS15169 Google LLC');
  });
});
