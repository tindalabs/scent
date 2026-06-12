import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

// CORS allowlist behaviour. No DB needed — createApp() is side-effect-free and
// /health sits before the auth middleware, so these run offline. The allowlist is
// read at createApp() time, so each test sets CORS_ALLOWED_ORIGINS then builds.
const PROD_ORIGIN = 'https://observatory.tindalabs.dev';

afterEach(() => {
  delete process.env['CORS_ALLOWED_ORIGINS'];
});

describe('CORS allowlist', () => {
  it('always allows a localhost dev origin', async () => {
    const res = await request(createApp())
      .get('/health')
      .set('Origin', 'http://localhost:4000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4000');
  });

  it('allows a production origin supplied via CORS_ALLOWED_ORIGINS', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = `${PROD_ORIGIN}, https://app.example.com`;
    const res = await request(createApp()).get('/health').set('Origin', PROD_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
  });

  it('does not allow an origin that is neither a dev default nor in the env list', async () => {
    process.env['CORS_ALLOWED_ORIGINS'] = PROD_ORIGIN;
    const res = await request(createApp())
      .get('/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows no-origin requests (curl / server-to-server)', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });
});
