import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { computeSimHash, simHashToHex, simHashToInt64, weightedJaccard } from '@tindalabs/scent-engine';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';

// Integration coverage for the *resolution decisions* in routes/events.ts —
// new-vs-returning boundary, ambiguous match, and cluster linking — that the
// happy-path suite doesn't reach. Gated on DATABASE_URL like the other
// integration suite (CI provides it; skips locally without a DB).
const hasDb = Boolean(process.env['DATABASE_URL']);
const API_KEY = 'integration-resolution-key';

// Base device: 4 stable (weight 0.9) + 5 moderate (0.55) signals.
const C = {
  'canvas.2d': 'res-canvas-AAA',
  'audio.hash': 'res-audio-AAA',
  'fonts.list': 'Arial,Helvetica,Times',
  'hardware.concurrency': 8,
  'screen.width': 2560,
  'screen.height': 1440,
  'locale.timezone': 'Europe/Madrid',
  'platform.os': 'Linux',
  'plugins.list': 'pdf-viewer',
} as const;

// Three moderate signals differ → weightedJaccard ≈ 0.81: a strong second
// candidate (≥ 0.60 ambiguity threshold) but below the 0.90 cluster threshold.
const C_AMBIGUOUS = { ...C, 'screen.width': 1280, 'locale.timezone': 'Asia/Tokyo', 'platform.os': 'Windows' };
// One stable signal differs → forgiven by the default single-mismatch tolerance
// → weightedJaccard ≈ 1.0, above the 0.90 cluster-link threshold.
const C_CLUSTER = { ...C, 'canvas.2d': 'res-canvas-ZZZ' };
// Fully disjoint device → confidence ≈ 0, resolves as a brand-new identity.
const DISJOINT = {
  'canvas.2d': 'zzz', 'audio.hash': 'zzz', 'fonts.list': 'Comic Sans',
  'hardware.concurrency': 2, 'screen.width': 320, 'screen.height': 480,
  'locale.timezone': 'Pacific/Auckland', 'platform.os': 'iOS', 'plugins.list': 'none',
} as const;

const app = createApp();
let projectId: string;

function post(signals: Record<string, unknown>) {
  return request(app)
    .post('/v1/events')
    .set('X-Api-Key', API_KEY)
    .send({
      snapshots: [{
        identityId: crypto.randomUUID(),
        signals,
        persistencePolicy: 'balanced',
        timestamp: new Date().toISOString(),
      }],
    });
}

// Seed a stored identity + one snapshot directly. `hashSignals` controls the
// stored signal_hash independently of the stored signals: forcing it equal to the
// incoming snapshot's hash guarantees the candidate passes the SimHash pre-filter,
// so the test exercises the *scoring/decision* logic in isolation (the pre-filter
// itself is covered by the engine SimHash tests).
async function seedIdentity(signals: Record<string, unknown>, hashSignals: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  const hash = computeSimHash(hashSignals);
  const signalHash = simHashToHex(hash);
  // Mirror production: the denormalized latest_signal_hash on the identity is
  // what the candidate pre-filter reads, so seed it from the same hashSignals.
  await db`
    INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, latest_signal_hash)
    VALUES (${id}, ${projectId}, 'high', 'low', ${db.json({})}, ${simHashToInt64(hash).toString()}::bigint)
  `;
  await db`
    INSERT INTO snapshots (identity_id, project_id, event_id, timestamp, signals, signal_hash, persistence_policy)
    VALUES (${id}, ${projectId}, ${`${id}:seed`}, ${new Date().toISOString()}, ${db.json(signals)}, ${signalHash}, 'balanced')
  `;
  return id;
}

async function clearIdentities(): Promise<void> {
  await db`DELETE FROM identities WHERE project_id = ${projectId}`; // cascades snapshots/drifts/links/cluster_merges
  await db`DELETE FROM clusters WHERE project_id = ${projectId}`;
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM projects WHERE api_key = ${API_KEY}`;
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key, name) VALUES (${API_KEY}, 'Resolution Integration') RETURNING id
  `;
  projectId = proj!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key = ${API_KEY}`;
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('resolution decision: new-vs-returning boundary', () => {
  beforeAll(clearIdentities);

  it('resolves a fully dissimilar device as a NEW identity even when others exist', async () => {
    await post(C); // an unrelated identity already exists in the project
    expect(weightedJaccard(DISJOINT, C).confidence).toBeLessThan(0.35); // precondition

    const sent = crypto.randomUUID();
    const res = await request(app).post('/v1/events').set('X-Api-Key', API_KEY).send({
      snapshots: [{ identityId: sent, signals: DISJOINT, persistencePolicy: 'balanced', timestamp: new Date().toISOString() }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0].isNew).toBe(true);
    expect(res.body.results[0].identityId).toBe(sent); // a new identity, not matched to the existing one
  });
});

describe.skipIf(!hasDb)('resolution decision: ambiguous match', () => {
  beforeAll(clearIdentities);

  it('flags ambiguous=true when a second candidate also scores above the ambiguity threshold', async () => {
    await seedIdentity(C, C);                    // exact match → confidence ~1.0 (best)
    await seedIdentity(C_AMBIGUOUS, C);          // ~0.81 → strong second candidate
    // precondition: the second candidate is genuinely in the ambiguous band [0.60, 0.90)
    const second = weightedJaccard(C, C_AMBIGUOUS).confidence;
    expect(second).toBeGreaterThanOrEqual(0.6);
    expect(second).toBeLessThan(0.9);

    const res = await post(C);
    expect(res.status).toBe(200);
    expect(res.body.results[0].isNew).toBe(false);
    expect(res.body.results[0].ambiguous).toBe(true);
  });
});

describe.skipIf(!hasDb)('resolution decision: cluster linking', () => {
  beforeAll(clearIdentities);

  it('links two ≥0.90 identities into a shared cluster', async () => {
    const a = await seedIdentity(C, C);
    const b = await seedIdentity(C_CLUSTER, C);  // ~1.0 after the single-stable-mismatch tolerance
    expect(weightedJaccard(C, C_CLUSTER).confidence).toBeGreaterThanOrEqual(0.9); // precondition

    await post(C);

    const rows = await db<{ id: string; cluster_id: string | null }[]>`
      SELECT id, cluster_id FROM identities WHERE id IN (${a}, ${b})
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cluster_id).not.toBeNull();
    expect(rows[0]!.cluster_id).toBe(rows[1]!.cluster_id); // both assigned to the same cluster
  });
});
