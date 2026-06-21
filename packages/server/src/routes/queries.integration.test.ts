import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashApiKey } from '../middleware/api-key.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Integration coverage for the read/query API (the GET routes + /v1/resolve), which
// the OpenAPI spec documents and the SDK/Observatory consume. Seeds a small graph and
// asserts status + response shape. Gated on DATABASE_URL like the other suites.
const hasDb = Boolean(process.env['DATABASE_URL']);
const API_KEY = 'queries-integration-key';
const ORG = 'Queries IT Org';

const app = createApp();
let projectId: string;
let clusterId: string;
const A = 'qit-identity-a';
const B = 'qit-identity-b';
const D = 'qit-identity-d';

function authed(method: 'get' | 'post', path: string) {
  return request(app)[method](path).set('X-Api-Key', API_KEY);
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, organization_id) VALUES (${hashApiKey(API_KEY)}, 'Queries Integration', ${org}) RETURNING id
  `;
  projectId = proj!.id;

  const [cluster] = await db<{ id: string }[]>`
    INSERT INTO clusters (project_id, reason) VALUES (${projectId}, 'high_confidence_signal_overlap') RETURNING id
  `;
  clusterId = cluster!.id;

  // Identities: A and B in the cluster, D standalone.
  for (const [id, cid] of [[A, clusterId], [B, clusterId], [D, null]] as const) {
    await db`
      INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, snapshot_count, cluster_id)
      VALUES (${id}, ${projectId}, 'high', 'low', ${db.json({})}, 2, ${cid})
    `;
  }

  // Two snapshots for A (so a drift can reference both) with a client IP.
  const base = Date.now();
  const ts = (off: number): string => new Date(base + off).toISOString();
  const [s1] = await db<{ id: string }[]>`
    INSERT INTO snapshots (identity_id, project_id, event_id, timestamp, signals, signal_hash, persistence_policy, client_ip)
    VALUES (${A}, ${projectId}, ${`${A}:1`}, ${ts(0)}, ${db.json({ 'canvas.2d': 'aaa' })}, 'hashA1', 'balanced', '8.8.8.8'::inet)
    RETURNING id
  `;
  const [s2] = await db<{ id: string }[]>`
    INSERT INTO snapshots (identity_id, project_id, event_id, timestamp, signals, signal_hash, persistence_policy, client_ip)
    VALUES (${A}, ${projectId}, ${`${A}:2`}, ${ts(1000)}, ${db.json({ 'canvas.2d': 'aab' })}, 'hashA2', 'balanced', '8.8.8.8'::inet)
    RETURNING id
  `;
  await db`
    INSERT INTO drifts (identity_id, before_snapshot_id, after_snapshot_id, classification, entropy, changed_signals, added_signals, removed_signals)
    VALUES (${A}, ${s1!.id}, ${s2!.id}, 'minor', 0.0400, ${['canvas.2d']}, ${[]}, ${[]})
  `;
  await db`
    INSERT INTO risk_assessments (identity_id, snapshot_id, score, band, flags)
    VALUES (${A}, ${s2!.id}, 0.1200, 'low', ${db.json([])})
  `;
  await db`
    INSERT INTO cluster_merges (cluster_id, identity_id, confidence, reason)
    VALUES (${clusterId}, ${A}, 0.9400, 'jaccard_similarity_above_threshold')
  `;
  // A linked to 3 accounts -> an account cluster.
  for (const acc of ['acct-1', 'acct-2', 'acct-3']) {
    await db`
      INSERT INTO identity_account_links (project_id, identity_id, account_id) VALUES (${projectId}, ${A}, ${acc})
    `;
  }
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('read/query API (integration)', () => {
  it('requires an API key (401)', async () => {
    expect((await request(app).get('/v1/identities')).status).toBe(401);
  });

  it('GET /v1/identities — paginated list', async () => {
    const res = await authed('get', '/v1/identities?limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10 });
    expect(typeof res.body.total).toBe('number');
    const ids = res.body.identities.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([A, B, D]));
    const a = res.body.identities.find((i: { id: string }) => i.id === A);
    expect(a).toMatchObject({ confidence_band: 'high', risk_band: 'low', snapshot_count: 2 });
  });

  it('GET /v1/identity/:id — record with latest risk', async () => {
    const res = await authed('get', `/v1/identity/${A}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: A, cluster_id: clusterId, risk_band: 'low' });
    expect(res.body.riskScore).toBeCloseTo(0.12);
    expect(Array.isArray(res.body.riskFlags)).toBe(true);
  });

  it('GET /v1/identity/:id — 404 for unknown id', async () => {
    expect((await authed('get', '/v1/identity/does-not-exist')).status).toBe(404);
  });

  it('GET /v1/identity/:id/timeline — drift history', async () => {
    const res = await authed('get', `/v1/identity/${A}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.drifts).toHaveLength(1);
    expect(res.body.drifts[0]).toMatchObject({ classification: 'minor', changed_signals: ['canvas.2d'] });
  });

  it('GET /v1/identity/:id/signals — latest signal map', async () => {
    const res = await authed('get', `/v1/identity/${A}/signals`);
    expect(res.status).toBe(200);
    expect(res.body.signals).toMatchObject({ 'canvas.2d': 'aab' }); // most recent snapshot
    expect(typeof res.body.asOf).toBe('string');
  });

  it('GET /v1/identity/:id/accounts — linked accounts', async () => {
    const res = await authed('get', `/v1/identity/${A}/accounts`);
    expect(res.status).toBe(200);
    expect(res.body.identityId).toBe(A);
    expect(res.body.accounts).toHaveLength(3);
    expect(res.body.accounts[0]).toHaveProperty('account_id');
  });

  it('GET /v1/account/:accountId/identities — reverse lookup', async () => {
    const res = await authed('get', '/v1/account/acct-1/identities');
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe('acct-1');
    expect(res.body.identities.map((i: { identity_id: string }) => i.identity_id)).toContain(A);
  });

  it('GET /v1/accounts/clusters — shared-device clusters', async () => {
    const res = await authed('get', '/v1/accounts/clusters?min=2');
    expect(res.status).toBe(200);
    expect(res.body.minAccounts).toBe(2);
    const cluster = res.body.clusters.find((c: { identity_id: string }) => c.identity_id === A);
    expect(cluster).toBeDefined();
    expect(cluster.account_count).toBe(3);
    expect(cluster.account_ids).toEqual(expect.arrayContaining(['acct-1', 'acct-2', 'acct-3']));
  });

  it('GET /v1/clusters/:id — cluster detail with members', async () => {
    const res = await authed('get', `/v1/clusters/${clusterId}`);
    expect(res.status).toBe(200);
    expect(res.body.cluster).toMatchObject({ id: clusterId, reason: 'high_confidence_signal_overlap' });
    const memberIds = res.body.members.map((m: { id: string }) => m.id);
    expect(memberIds).toEqual(expect.arrayContaining([A, B]));
    const a = res.body.members.find((m: { id: string }) => m.id === A);
    expect(a.merge_confidence).toBeCloseTo(0.94);
  });

  it('GET /v1/clusters/:id — 404 for unknown cluster', async () => {
    expect((await authed('get', '/v1/clusters/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('GET /v1/dashboard — aggregate metrics', async () => {
    const res = await authed('get', '/v1/dashboard');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalIdentities).toBe('number');
    expect(Array.isArray(res.body.riskDistribution)).toBe(true);
    expect(Array.isArray(res.body.driftRateTrend)).toBe(true);
  });

  it('POST /v1/resolve — inline resolution result shape', async () => {
    const res = await authed('post', '/v1/resolve')
      .set('Content-Type', 'application/json')
      .send({ signals: { 'canvas.2d': 'aaa' } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('confidenceBand');
    expect(res.body).toHaveProperty('continuity');
    expect(res.body).toHaveProperty('isNew');
    expect(res.body).toHaveProperty('signalHash');
    expect(res.body.risk).toHaveProperty('band');
  });
});
