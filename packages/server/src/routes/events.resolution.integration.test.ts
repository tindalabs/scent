import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { computeSimHash, simHashToHex, simHashToInt64, weightedJaccard } from '@tindalabs/scent-engine';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { resolveSnapshot } from '../pipeline/resolve.js';
import { hashApiKey } from '../middleware/api-key.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Integration coverage for the *resolution decisions* — new-vs-returning boundary,
// ambiguous match, and cluster linking — that the happy-path suite doesn't reach.
// Since async ingest moved this logic out of the HTTP route and into the background
// worker, these drive resolveSnapshot() directly (deterministic, no queue/worker in
// the loop). Gated on DATABASE_URL like the other integration suite (CI provides it;
// skips locally without a DB).
const hasDb = Boolean(process.env['DATABASE_URL']);
const API_KEY = 'integration-resolution-key';
const ORG = 'Resolution IT Org';

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

let projectId: string;

// Resolve a snapshot through the extracted pipeline, exactly as the worker does.
function resolve(signals: Record<string, unknown>) {
  return resolveSnapshot(db, {
    projectId,
    snap: {
      identityId: crypto.randomUUID(),
      signals: signals as Record<string, string | number | boolean | null>,
      persistencePolicy: 'balanced',
      timestamp: new Date().toISOString(),
    },
    clientIp: null,
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
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, organization_id) VALUES (${hashApiKey(API_KEY)}, 'Resolution Integration', ${org}) RETURNING id
  `;
  projectId = proj!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('resolution decision: new-vs-returning boundary', () => {
  beforeAll(clearIdentities);

  it('resolves a fully dissimilar device as a NEW identity even when others exist', async () => {
    await resolve(C); // an unrelated identity already exists in the project
    expect(weightedJaccard(DISJOINT, C).confidence).toBeLessThan(0.35); // precondition

    const r = await resolve(DISJOINT);
    expect(r.isNew).toBe(true); // a new identity, not matched to the existing one
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

    const r = await resolve(C);
    expect(r.isNew).toBe(false);
    expect(r.ambiguous).toBe(true);
  });
});

describe.skipIf(!hasDb)('resolution decision: cluster linking', () => {
  beforeAll(clearIdentities);

  it('links two ≥0.90 identities into a shared cluster', async () => {
    const a = await seedIdentity(C, C);
    const b = await seedIdentity(C_CLUSTER, C);  // ~1.0 after the single-stable-mismatch tolerance
    expect(weightedJaccard(C, C_CLUSTER).confidence).toBeGreaterThanOrEqual(0.9); // precondition

    await resolve(C);

    const rows = await db<{ id: string; cluster_id: string | null }[]>`
      SELECT id, cluster_id FROM identities WHERE id IN (${a}, ${b})
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cluster_id).not.toBeNull();
    expect(rows[0]!.cluster_id).toBe(rows[1]!.cluster_id); // both assigned to the same cluster
  });
});

describe.skipIf(!hasDb)('resolution decision: concurrent identical snapshots', () => {
  beforeAll(clearIdentities);

  it('collapses concurrent identical observations of a brand-new device into ONE identity', async () => {
    // Two identical-signal snapshots (distinct SDK ids) resolved at the same time. The
    // per-fingerprint advisory lock must serialize them so the second sees the first's
    // committed identity and matches it — instead of both racing past an empty
    // candidate set into separate "new" identities (the duplicate-orphan bug that left
    // snapshot_count=0 / band 'unknown' rows).
    const UNIQUE = { ...C, 'canvas.2d': 'concurrency-canvas-XYZ', 'audio.hash': 'concurrency-audio-XYZ' };

    const [r1, r2] = await Promise.all([resolve(UNIQUE), resolve(UNIQUE)]);

    expect(new Set([r1.identityId, r2.identityId]).size).toBe(1); // both resolved to one id
    expect([r1.isNew, r2.isNew].filter(Boolean)).toHaveLength(1); // exactly one created it

    // And the store holds a single identity for this fingerprint — no orphan duplicate.
    const hash = simHashToHex(computeSimHash(UNIQUE));
    const idents = await db<{ id: string }[]>`
      SELECT DISTINCT identity_id AS id FROM snapshots
      WHERE project_id = ${projectId} AND signal_hash = ${hash}
    `;
    expect(idents).toHaveLength(1);
  });
});
