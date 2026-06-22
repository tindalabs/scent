import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { scrubPii } from './instrument.js';

// scrubPii is the privacy boundary for error reporting: this is a fingerprinting
// product, so a stack trace must never carry a subject's raw signals or an API key.
// Verified directly rather than trusted to integration coverage.
describe('scrubPii', () => {
  it('strips the request body, cookies, and query string', () => {
    const event = {
      request: {
        data: { fingerprint: 'raw-device-signals', email: 'user@example.com' },
        cookies: { scent_admin: 'session-token' },
        query_string: 'token=secret',
      },
    } as ErrorEvent;

    const out = scrubPii(event);

    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
  });

  it('strips sensitive headers case-insensitively but keeps benign ones', () => {
    const event = {
      request: {
        headers: {
          'X-Api-Key': 'pk_live_abc',
          Cookie: 'scent_admin=tok',
          Authorization: 'Bearer xyz',
          'Content-Type': 'application/json',
          'user-agent': 'curl/8',
        },
      },
    } as unknown as ErrorEvent;

    const headers = scrubPii(event).request?.headers ?? {};

    expect(headers['X-Api-Key']).toBeUndefined();
    expect(headers['Cookie']).toBeUndefined();
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['user-agent']).toBe('curl/8');
  });

  it('strips the client IP from user context', () => {
    const event = {
      user: { id: 'admin-1', ip_address: '203.0.113.7' },
    } as unknown as ErrorEvent;

    const out = scrubPii(event);

    expect(out.user?.ip_address).toBeUndefined();
    expect(out.user?.id).toBe('admin-1'); // non-PII identifier retained
  });

  it('is a no-op on an event with no request or user', () => {
    const event = { message: 'boom' } as ErrorEvent;
    expect(scrubPii(event)).toEqual({ message: 'boom' });
  });
});
