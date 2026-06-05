import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';

// Integration tests hit a real Postgres + Redis. They run in CI (which provides
// DATABASE_URL/REDIS_URL via service containers) and locally when those env vars
// are set (`docker compose up -d postgres redis`); otherwise the whole suite skips
// so `pnpm test` stays green on a machine with no database.
const hasDb = Boolean(process.env['DATABASE_URL']);

const API_KEY = 'integration-test-key';

// A rich, stable signal set: identical re-submissions resolve to the same identity
// with high confidence (canvas/audio/fonts/hardware dominate the weighting).
const SIGNALS = {
  'canvas.2d': 'canvashash-integration-AAA',
  'webgl.vendor': 'Acme GPU Co',
  'webgl.renderer': 'Acme RTX 9000',
  'audio.fp': 'audiofp-771',
  'fonts.list': 'Arial,Helvetica,Times New Roman',
  'hw.concurrency': 8,
  'hw.memory': 16,
  'screen.width': 2560,
  'screen.height': 1440,
  'tz.offset': -60,
  'locale.lang': 'en-US',
  'platform.os': 'Linux',
} as const;

// A distinct device for the account-linking group, so it never resolves into the
// resolution group's identity.
const SIGNALS_B = {
  ...SIGNALS,
  'canvas.2d': 'canvashash-integration-BBB',
  'webgl.renderer': 'Beta GTX 1000',
  'audio.fp': 'audiofp-999',
  'fonts.list': 'Verdana,Tahoma,Courier New',
} as const;

const app = createApp();
const base = Date.now();
const ts = (offsetMs: number): string => new Date(base + offsetMs).toISOString();

function snapshot(id: string, timestamp: string, signals: Record<string, unknown> = SIGNALS) {
  return { snapshots: [{ identityId: id, signals, persistencePolicy: 'balanced', timestamp }] };
}

// Connections and the seeded project are managed once at file scope so the two
// groups below share them without closing them out from under each other.
beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM projects WHERE api_key = ${API_KEY}`; // cascades to identities/snapshots/links
  await db`INSERT INTO projects (api_key, name) VALUES (${API_KEY}, 'Integration Test')`;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key = ${API_KEY}`;
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('POST /v1/events — identity resolution (integration)', () => {
  let firstId: string;

  it('rejects a request with no API key (401)', async () => {
    const res = await request(app).post('/v1/events').send(snapshot(crypto.randomUUID(), ts(0)));
    expect(res.status).toBe(401);
  });

  it('rejects an unknown API key (401)', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', 'nope-not-a-real-key')
      .send(snapshot(crypto.randomUUID(), ts(0)));
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload (400)', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send({ snapshots: [{ identityId: 'not-a-uuid', signals: {}, persistencePolicy: 'balanced' }] });
    expect(res.status).toBe(400);
  });

  it('resolves a first-seen device as a NEW identity', async () => {
    firstId = crypto.randomUUID();
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(firstId, ts(1000)));

    expect(res.status).toBe(200);
    const r = res.body.results[0];
    expect(r.identityId).toBe(firstId);
    expect(r.isNew).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('resolves a returning device (same signals) to the SAME identity', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(crypto.randomUUID(), ts(2000))); // different client id, identical signals

    expect(res.status).toBe(200);
    const r = res.body.results[0];
    expect(r.identityId).toBe(firstId);   // matched back to the first identity
    expect(r.isNew).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.35);
    expect(r.continuity).not.toBe('unknown');
  });

  it('records drift for the returning identity', async () => {
    // Change a few volatile signals so a drift row is written.
    const drifted = { ...SIGNALS, 'screen.width': 1920, 'screen.height': 1080, 'tz.offset': 120 };
    await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(crypto.randomUUID(), ts(3000), drifted));

    const drifts = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM drifts WHERE identity_id = ${firstId}
    `;
    expect(Number(drifts[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent: a duplicate event_id (same id + timestamp) is a no-op', async () => {
    const dupId = crypto.randomUUID();
    const when = ts(4000);
    const first = await request(app).post('/v1/events').set('X-Api-Key', API_KEY).send(snapshot(dupId, when));
    const second = await request(app).post('/v1/events').set('X-Api-Key', API_KEY).send(snapshot(dupId, when));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM snapshots WHERE event_id = ${`${dupId}:${when}`}
    `;
    expect(rows[0]!.count).toBe('1');
  });
});

describe.skipIf(!hasDb)('account linking + coordinated_accounts (integration)', () => {
  let identityId: string;

  beforeAll(async () => {
    // Seed one resolved identity (distinct device) to link accounts to. Capture the
    // server-resolved id rather than assuming it equals the client-sent uuid.
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(crypto.randomUUID(), ts(10_000), SIGNALS_B));
    identityId = res.body.results[0].identityId;
  });

  it('links accounts and upserts link_count on repeats', async () => {
    for (const acc of ['acct-a', 'acct-b', 'acct-c']) {
      const res = await request(app)
        .post(`/v1/identity/${identityId}/link`)
        .set('X-Api-Key', API_KEY)
        .send({ accountId: acc });
      expect(res.status).toBe(200);
    }
    const repeat = await request(app)
      .post(`/v1/identity/${identityId}/link`)
      .set('X-Api-Key', API_KEY)
      .send({ accountId: 'acct-a' });
    expect(repeat.body.linkCount).toBe(2);

    const accounts = await request(app)
      .get(`/v1/identity/${identityId}/accounts`)
      .set('X-Api-Key', API_KEY);
    expect(accounts.body.accounts).toHaveLength(3);
  });

  it('the reverse lookup returns the identity for an account', async () => {
    const res = await request(app).get('/v1/account/acct-a/identities').set('X-Api-Key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.identities.map((i: { identity_id: string }) => i.identity_id)).toContain(identityId);
  });

  it('the clusters endpoint surfaces the identity (3 accounts ≥ min 2)', async () => {
    const res = await request(app).get('/v1/accounts/clusters').set('X-Api-Key', API_KEY);
    expect(res.status).toBe(200);
    const cluster = res.body.clusters.find((c: { identity_id: string }) => c.identity_id === identityId);
    expect(cluster).toBeDefined();
    expect(cluster.account_count).toBe(3);
  });

  it('raises the coordinated_accounts risk flag on the next event', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(crypto.randomUUID(), ts(11_000), SIGNALS_B));
    expect(res.body.results[0].risk.flags).toContain('coordinated_accounts');
  });
});
