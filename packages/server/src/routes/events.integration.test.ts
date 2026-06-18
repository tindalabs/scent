import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Worker } from 'bullmq';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { resolveSnapshot } from '../pipeline/resolve.js';
import { createQueueConnection, INGEST_QUEUE_NAME } from '../queue/ingest.js';
import type { IngestJobData } from '../queue/ingest.js';
import { hashApiKey } from '../middleware/api-key.js';

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

let projectId: string;

// Build the { snapshots: [...] } HTTP envelope (still used by the auth/validation
// and end-to-end tests that exercise the real route).
function snapshot(id: string, timestamp: string, signals: Record<string, unknown> = SIGNALS) {
  return { snapshots: [{ identityId: id, signals, persistencePolicy: 'balanced', timestamp }] };
}

// Resolve a snapshot through the extracted pipeline, exactly as the worker does.
// Async ingest moved resolution out of the HTTP response, so the resolution
// assertions call resolveSnapshot() directly rather than reading res.body.
function resolve(id: string, timestamp: string, signals: Record<string, unknown> = SIGNALS) {
  return resolveSnapshot(db, {
    projectId,
    snap: {
      identityId: id,
      signals: signals as Record<string, string | number | boolean | null>,
      persistencePolicy: 'balanced',
      timestamp,
    },
    clientIp: null,
  });
}

// Connections and the seeded project are managed once at file scope so the two
// groups below share them without closing them out from under each other.
beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`; // cascades to identities/snapshots/links
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name) VALUES (${hashApiKey(API_KEY)}, 'Integration Test') RETURNING id
  `;
  projectId = proj!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('POST /v1/events — auth, validation, enqueue (integration)', () => {
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

  it('accepts a valid batch with 202 { accepted } and enqueues (does not resolve inline)', async () => {
    const res = await request(app)
      .post('/v1/events')
      .set('X-Api-Key', API_KEY)
      .send(snapshot(crypto.randomUUID(), ts(500)));
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.results).toBeUndefined(); // no inline resolution body anymore
  });
});

describe.skipIf(!hasDb)('identity resolution pipeline (integration)', () => {
  let firstId: string;

  it('resolves a first-seen device as a NEW identity', async () => {
    firstId = crypto.randomUUID();
    const r = await resolve(firstId, ts(1000));
    expect(r.identityId).toBe(firstId);
    expect(r.isNew).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('resolves a returning device (same signals) to the SAME identity', async () => {
    const r = await resolve(crypto.randomUUID(), ts(2000)); // different client id, identical signals
    expect(r.identityId).toBe(firstId); // matched back to the first identity
    expect(r.isNew).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.35);
    expect(r.continuity).not.toBe('unknown');
  });

  it('records drift for the returning identity', async () => {
    // Change a few volatile signals so a drift row is written.
    const drifted = { ...SIGNALS, 'screen.width': 1920, 'screen.height': 1080, 'tz.offset': 120 };
    await resolve(crypto.randomUUID(), ts(3000), drifted);

    const drifts = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM drifts WHERE identity_id = ${firstId}
    `;
    expect(Number(drifts[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent: a duplicate event_id (same id + timestamp) is a no-op', async () => {
    const dupId = crypto.randomUUID();
    const when = ts(4000);
    await resolve(dupId, when);
    await resolve(dupId, when);

    const rows = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM snapshots WHERE event_id = ${`${dupId}:${when}`}
    `;
    expect(rows[0]!.count).toBe('1');
  });
});

describe.skipIf(!hasDb)('consent provenance + IP minimization (integration)', () => {
  // A distinct device so it gets its own identity/snapshot row.
  const SIGNALS_C = {
    ...SIGNALS,
    'canvas.2d': 'canvashash-integration-CCC',
    'webgl.renderer': 'Gamma RX 500',
    'audio.fp': 'audiofp-555',
    'fonts.list': 'Georgia,Garamond,Consolas',
  } as const;

  function resolveCtx(
    timestamp: string,
    clientIp: string | null,
    extra: Partial<{ lawfulBasis: 'consent' | 'legitimate_interest' | 'strictly_necessary'; consentVersion: string; consentedAt: string }> = {},
  ) {
    return resolveSnapshot(db, {
      projectId,
      snap: {
        identityId: crypto.randomUUID(),
        signals: SIGNALS_C as Record<string, string | number | boolean | null>,
        persistencePolicy: 'balanced',
        timestamp,
        ...extra,
      },
      clientIp,
    });
  }

  it('stores a /24-truncated IPv4 by default and the consent provenance', async () => {
    const r = await resolveCtx(ts(30_000), '203.0.113.45', {
      lawfulBasis: 'consent',
      consentVersion: 'policy-v2',
      consentedAt: ts(29_000),
    });
    const [row] = await db<{ ip: string | null; lawful_basis: string; consent_version: string; consented_at: Date | null }[]>`
      SELECT host(client_ip) AS ip, lawful_basis, consent_version, consented_at
      FROM snapshots WHERE identity_id = ${r.identityId} ORDER BY timestamp DESC LIMIT 1
    `;
    expect(row!.ip).toBe('203.0.113.0'); // host bits dropped
    expect(row!.lawful_basis).toBe('consent');
    expect(row!.consent_version).toBe('policy-v2');
    expect(row!.consented_at).not.toBeNull();
  });

  it('stores the full IP when the project opts in via store_full_ip', async () => {
    await db`UPDATE projects SET store_full_ip = true WHERE id = ${projectId}`;
    try {
      const r = await resolveCtx(ts(31_000), '203.0.113.45');
      const [row] = await db<{ ip: string | null }[]>`
        SELECT host(client_ip) AS ip FROM snapshots WHERE identity_id = ${r.identityId} ORDER BY timestamp DESC LIMIT 1
      `;
      expect(row!.ip).toBe('203.0.113.45'); // full address retained
    } finally {
      await db`UPDATE projects SET store_full_ip = false WHERE id = ${projectId}`;
    }
  });

  it("defaults lawful_basis to the project default when the snapshot omits it", async () => {
    const r = await resolveCtx(ts(32_000), '198.51.100.7'); // no lawfulBasis passed
    const [row] = await db<{ lawful_basis: string }[]>`
      SELECT lawful_basis FROM snapshots WHERE identity_id = ${r.identityId} ORDER BY timestamp DESC LIMIT 1
    `;
    expect(row!.lawful_basis).toBe('consent'); // migration default
  });
});

describe.skipIf(!hasDb)('end-to-end: POST /v1/events → worker → DB', () => {
  it('a snapshot enqueued via the route is resolved by the worker and persisted', async () => {
    const id = crypto.randomUUID();
    const when = ts(20_000);
    const eventId = `${id}:${when}`;

    // Spin up a real worker on the ingest queue for the duration of this test.
    const worker = new Worker<IngestJobData>(
      INGEST_QUEUE_NAME,
      async (job) => resolveSnapshot(db, job.data),
      { connection: createQueueConnection(), concurrency: 1 },
    );

    try {
      // Match our specific job: the worker also drains any backlog enqueued by
      // earlier tests (which ran with no worker up), so a bare 'completed' could
      // fire for someone else's job before ours is processed.
      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', (job) => {
          if (job.data.snap.identityId === id) resolve();
        });
        worker.on('failed', (job, err) => {
          if (job?.data.snap.identityId === id) reject(err);
        });
      });

      const res = await request(app)
        .post('/v1/events')
        .set('X-Api-Key', API_KEY)
        .send(snapshot(id, when, SIGNALS_B));
      expect(res.status).toBe(202);

      await completed;

      const rows = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM snapshots WHERE event_id = ${eventId}
      `;
      expect(rows[0]!.count).toBe('1');
    } finally {
      await worker.close();
    }
  });
});

describe.skipIf(!hasDb)('account linking + coordinated_accounts (integration)', () => {
  let identityId: string;

  beforeAll(async () => {
    // Seed one resolved identity (distinct device) to link accounts to. Capture the
    // server-resolved id rather than assuming it equals the client-sent uuid.
    const r = await resolve(crypto.randomUUID(), ts(10_000), SIGNALS_B);
    identityId = r.identityId;
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
    const r = await resolve(crypto.randomUUID(), ts(11_000), SIGNALS_B);
    expect(r.risk.flags).toContain('coordinated_accounts');
  });
});

describe.skipIf(!hasDb)('data-subject endpoints — export + erasure (integration)', () => {
  // A distinct device so erasing it can't disturb the other groups' identities.
  const SIGNALS_D = {
    ...SIGNALS,
    'canvas.2d': 'canvashash-integration-DDD',
    'webgl.renderer': 'Delta Arc 770',
    'audio.fp': 'audiofp-404',
    'fonts.list': 'Menlo,Monaco,Inconsolata',
  } as const;

  it('GET /export returns the full bundle, then DELETE erases it (cascade)', async () => {
    const r = await resolve(crypto.randomUUID(), ts(40_000), SIGNALS_D);
    const id = r.identityId;

    const exp = await request(app).get(`/v1/identity/${id}/export`).set('X-Api-Key', API_KEY);
    expect(exp.status).toBe(200);
    expect(exp.body.identity.id).toBe(id);
    expect(exp.body.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(exp.body.accounts)).toBe(true);

    const del = await request(app).delete(`/v1/identity/${id}`).set('X-Api-Key', API_KEY);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/v1/identity/${id}`).set('X-Api-Key', API_KEY);
    expect(after.status).toBe(404);

    const snaps = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM snapshots WHERE identity_id = ${id}
    `;
    expect(snaps[0]!.count).toBe('0'); // snapshots cascaded
  });

  it('DELETE without an API key is rejected (401 — erasure is key-gated)', async () => {
    const res = await request(app).delete(`/v1/identity/${crypto.randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it('DELETE of an unknown identity returns 404', async () => {
    const res = await request(app)
      .delete(`/v1/identity/${crypto.randomUUID()}`)
      .set('X-Api-Key', API_KEY);
    expect(res.status).toBe(404);
  });
});
