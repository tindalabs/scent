import { describe, it, expect } from 'vitest';
import { minimizeIp } from './minimize-ip.js';

describe('minimizeIp', () => {
  it('truncates IPv4 to /24 (zeroes the last octet)', () => {
    expect(minimizeIp('203.0.113.45', false)).toBe('203.0.113.0');
    expect(minimizeIp('8.8.8.8', false)).toBe('8.8.8.0');
  });

  it('truncates IPv6 to /48 (keeps the first three hextets)', () => {
    expect(minimizeIp('2001:db8:1234:5678:9abc:def0:1111:2222', false)).toBe('2001:db8:1234::');
    expect(minimizeIp('2001:db8:abcd::1', false)).toBe('2001:db8:abcd::');
  });

  it('keeps the full address when storeFull is true', () => {
    expect(minimizeIp('203.0.113.45', true)).toBe('203.0.113.45');
    expect(minimizeIp('2001:db8:1234:5678::1', true)).toBe('2001:db8:1234:5678::1');
  });

  it('strips an IPv6 zone id before truncating', () => {
    expect(minimizeIp('fe80::1%eth0', false)).toBe('fe80:0:0::');
  });

  it('returns null for null/empty/unrecognised input', () => {
    expect(minimizeIp(null, false)).toBeNull();
    expect(minimizeIp(undefined, false)).toBeNull();
    expect(minimizeIp('', false)).toBeNull();
    expect(minimizeIp('not-an-ip', false)).toBeNull();
  });
});
