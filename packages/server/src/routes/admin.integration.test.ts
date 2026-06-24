import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashPassword } from '../admin/password.js';
import { hashApiKey } from '../middleware/api-key.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';
import { resolveSnapshot } from '../pipeline/resolve.js';

// Integration coverage for the admin management API: login/session, and project key
// create/rotate/revoke including the data-API (/v1) authorization side effects and
// the Redis auth-cache invalidation. Gated on DATABASE_URL like the other suites.
const hasDb = Boolean(process.env['DATABASE_URL']);
const EMAIL = 'admin-int@example.com';
const PASSWORD = 'test-password-123';
const ORG = 'AdminIT Org';

const app = createApp();

// Pull the double-submit CSRF token out of a Set-Cookie header.
function csrfFrom(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = cookies.find((x) => x.startsWith('scent_csrf='));
  return c ? c.split(';')[0]!.slice('scent_csrf='.length) : '';
}

// Hit the data API with a given key — used to assert keys (in)validate as expected.
function resolveWith(apiKey: string) {
  return request(app)
    .post('/v1/resolve')
    .set('X-Api-Key', apiKey)
    .set('Content-Type', 'application/json')
    .send({ signals: { 'canvas.2d': 'admin-int' } });
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM admin_users WHERE email = ${EMAIL}`;
  await db`DELETE FROM projects WHERE name LIKE 'AdminIT %'`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  await db`INSERT INTO admin_users (email, password_hash, role, organization_id) VALUES (${EMAIL}, ${await hashPassword(PASSWORD)}, 'owner', ${org})`;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM admin_users WHERE email = ${EMAIL}`;
  await db`DELETE FROM projects WHERE name LIKE 'AdminIT %'`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('admin management API (integration)', () => {
  // Cookie jar shared across the authenticated flow.
  const agent = request.agent(app);
  let projectId: string;
  let apiKey: string;
  let csrf = '';

  it('rejects unauthenticated admin requests (401)', async () => {
    const res = await request(app).get('/admin/projects');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password (401)', async () => {
    const res = await request(app).post('/admin/login').send({ email: EMAIL, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logs in and exposes the session via /admin/me', async () => {
    const login = await agent.post('/admin/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.email).toBe(EMAIL);
    csrf = csrfFrom(login.headers['set-cookie']);
    expect(csrf).not.toBe('');

    const me = await agent.get('/admin/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(EMAIL);
  });

  it('rejects a mutation without the CSRF token (403)', async () => {
    const res = await agent.post('/admin/projects').send({ name: 'AdminIT NoCsrf' });
    expect(res.status).toBe(403);
  });

  it('creates a project, returns the key once, stores only its hash', async () => {
    const res = await agent.post('/admin/projects').set('X-CSRF-Token', csrf).send({ name: 'AdminIT Alpha' });
    expect(res.status).toBe(201);
    apiKey = res.body.apiKey;
    projectId = res.body.project.id;
    expect(apiKey).toHaveLength(64);
    expect(res.body.project.key_prefix).toBe(apiKey.slice(0, 8));

    const [row] = await db<{ api_key_hash: string; key_prefix: string }[]>`
      SELECT api_key_hash, key_prefix FROM projects WHERE id = ${projectId}
    `;
    expect(row!.api_key_hash).toBe(hashApiKey(apiKey)); // hash stored
    expect(row!.api_key_hash).not.toBe(apiKey);          // never the plaintext
    expect(row!.key_prefix).toBe(apiKey.slice(0, 8));

    // The minted key authenticates the data API (and warms the Redis auth cache).
    expect((await resolveWith(apiKey)).status).toBe(200);
  });

  it('rotates the key: old key dies immediately (cache busted), new key works', async () => {
    const oldHash = hashApiKey(apiKey);
    expect(await redis.get(`proj:${oldHash}`)).not.toBeNull(); // warmed by previous test

    const res = await agent.post(`/admin/projects/${projectId}/rotate`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    const newKey: string = res.body.apiKey;
    expect(newKey).not.toBe(apiKey);

    expect(await redis.get(`proj:${oldHash}`)).toBeNull();   // cache busted on rotate
    expect((await resolveWith(apiKey)).status).toBe(401);    // old key rejected
    expect((await resolveWith(newKey)).status).toBe(200);    // new key accepted

    apiKey = newKey;
  });

  it('deletes the project: its key stops working', async () => {
    const res = await agent.delete(`/admin/projects/${projectId}`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    expect((await resolveWith(apiKey)).status).toBe(401);
    const rows = await db`SELECT id FROM projects WHERE id = ${projectId}`;
    expect(rows).toHaveLength(0);
  });

  it('reports org-scoped usage via GET /admin/usage', async () => {
    // Set a soft limit, then create a project and commit one resolution. We drive
    // resolveSnapshot directly (the metered, persisting path); POST /v1/resolve is a
    // non-persisting preview and intentionally does not count toward usage.
    await db`UPDATE organizations SET monthly_resolution_limit = 1000 WHERE name = ${ORG}`;
    const created = await agent.post('/admin/projects').set('X-CSRF-Token', csrf).send({ name: 'AdminIT Usage' });
    expect(created.status).toBe(201);
    await resolveSnapshot(db, {
      projectId: created.body.project.id,
      snap: {
        identityId: crypto.randomUUID(),
        signals: { 'canvas.2d': crypto.randomUUID(), 'platform.os': 'Linux' },
        persistencePolicy: 'balanced',
        timestamp: new Date().toISOString(),
      },
      clientIp: null,
    });

    const res = await agent.get('/admin/usage');
    expect(res.status).toBe(200);
    expect(res.body.plan).toBeDefined();
    expect(res.body.limit).toBe(1000);
    expect(res.body.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(res.body.resolutionsThisPeriod).toBeGreaterThanOrEqual(1);
    expect(res.body.pctUsed).toBeGreaterThan(0);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('logout clears the session', async () => {
    await agent.post('/admin/logout').set('X-CSRF-Token', csrf);
    const me = await agent.get('/admin/me');
    expect(me.status).toBe(401);
  });
});
