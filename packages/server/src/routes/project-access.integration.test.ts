import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashApiKey } from '../middleware/api-key.js';
import { hashPassword } from '../admin/password.js';

// Integration coverage for requireProjectRead: the /v1 read routes accept EITHER a
// project API key OR an admin session + X-Project-Id (GET only). Asserts both auth
// paths, project isolation, the header/auth failure modes, and that ingest stays
// strictly key-gated (a session must not reach a write path). Gated on DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);

const EMAIL = 'project-access-it@example.com';
const PASSWORD = 'test-password-123';
const KEY_A = 'project-access-it-key-a';
const KEY_B = 'project-access-it-key-b';
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

const app = createApp();
let idA: string;
let idB: string;

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM admin_users WHERE email = ${EMAIL}`;
  await db`DELETE FROM projects WHERE name LIKE 'ProjAccessIT %'`;

  await db`INSERT INTO admin_users (email, password_hash) VALUES (${EMAIL}, ${await hashPassword(PASSWORD)})`;

  const [projA] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name) VALUES (${hashApiKey(KEY_A)}, 'ProjAccessIT A') RETURNING id
  `;
  const [projB] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name) VALUES (${hashApiKey(KEY_B)}, 'ProjAccessIT B') RETURNING id
  `;
  idA = projA!.id;
  idB = projB!.id;

  // Distinct identity counts so a project mix-up is visible in dashboard totals:
  // 3 in A, 1 in B.
  for (const n of [1, 2, 3]) {
    await db`
      INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, snapshot_count)
      VALUES (${`pait-a-${n}`}, ${idA}, 'high', 'low', ${db.json({})}, 1)
    `;
  }
  await db`
    INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, snapshot_count)
    VALUES (${'pait-b-1'}, ${idB}, 'high', 'low', ${db.json({})}, 1)
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM admin_users WHERE email = ${EMAIL}`;
  await db`DELETE FROM projects WHERE name LIKE 'ProjAccessIT %'`;
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('requireProjectRead (integration)', () => {
  const agent = request.agent(app);

  beforeAll(async () => {
    if (!hasDb) return;
    const login = await agent.post('/admin/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('serves project data via an admin session + X-Project-Id', async () => {
    const res = await agent.get('/v1/dashboard').set('X-Project-Id', idA);
    expect(res.status).toBe(200);
    expect(res.body.totalIdentities).toBe(3);
  });

  it('scopes strictly to the selected project (isolation)', async () => {
    const res = await agent.get('/v1/dashboard').set('X-Project-Id', idB);
    expect(res.status).toBe(200);
    expect(res.body.totalIdentities).toBe(1);
  });

  it('rejects a session request with no X-Project-Id (400)', async () => {
    const res = await agent.get('/v1/dashboard');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed X-Project-Id (400)', async () => {
    const res = await agent.get('/v1/dashboard').set('X-Project-Id', 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but unknown project id', async () => {
    const res = await agent.get('/v1/dashboard').set('X-Project-Id', UNKNOWN_UUID);
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request — no session, no key (401)', async () => {
    const res = await request(app).get('/v1/dashboard').set('X-Project-Id', idA);
    expect(res.status).toBe(401);
  });

  it('still authorizes via a project API key (no session needed)', async () => {
    const res = await request(app).get('/v1/dashboard').set('X-Api-Key', KEY_A);
    expect(res.status).toBe(200);
    expect(res.body.totalIdentities).toBe(3);
  });

  it('does NOT let an admin session reach ingest — /v1/events stays key-only (401)', async () => {
    const res = await agent
      .post('/v1/events')
      .set('X-Project-Id', idA)
      .send({ snapshots: [{ eventId: 'pait-evt-1', signals: { 'canvas.2d': 'x' } }] });
    expect(res.status).toBe(401);
  });
});
