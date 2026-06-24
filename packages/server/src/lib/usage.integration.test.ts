import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { resolveSnapshot } from '../pipeline/resolve.js';
import { hashApiKey } from '../middleware/api-key.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';
import { checkAndWarnThreshold } from './usage.js';

// Usage metering: the billable unit is one committed resolution. Verifies the counter
// increments exactly once per resolution (and not on dedup), rolls up per organization,
// stays org-isolated, and that the soft-threshold guards flip once. Gated on DATABASE_URL
// like the other integration suites (CI provides it; skips locally without a DB).
const hasDb = Boolean(process.env['DATABASE_URL']);

const ORG_A = 'Usage IT Org A';
const ORG_B = 'Usage IT Org B';
const KEY_A1 = 'usage-it-key-a1';
const KEY_A2 = 'usage-it-key-a2';
const KEY_B1 = 'usage-it-key-b1';

let orgAId: string;
let orgBId: string;
let projA1: string;
let projA2: string;
let projB1: string;

function currentPeriod(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function usageCount(orgId: string): Promise<number> {
  const [row] = await db<{ resolution_count: string }[]>`
    SELECT resolution_count FROM usage_counters
    WHERE organization_id = ${orgId} AND period_start = ${currentPeriod()}::date
  `;
  return row ? Number(row.resolution_count) : 0;
}

// Distinct signals per call (unless overridden) so each resolves as its own identity —
// keeps the metering assertions independent of the matching/cluster logic.
function resolveOn(
  projectId: string,
  opts: { identityId?: string; timestamp?: string } = {},
): ReturnType<typeof resolveSnapshot> {
  return resolveSnapshot(db, {
    projectId,
    snap: {
      identityId: opts.identityId ?? crypto.randomUUID(),
      signals: { 'canvas.2d': crypto.randomUUID(), 'audio.hash': crypto.randomUUID(), 'platform.os': 'Linux' },
      persistencePolicy: 'balanced',
      timestamp: opts.timestamp ?? new Date().toISOString(),
    },
    clientIp: null,
  });
}

async function makeProject(apiKey: string, name: string, orgId: string): Promise<string> {
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, organization_id)
    VALUES (${hashApiKey(apiKey)}, ${name}, ${orgId}) RETURNING id
  `;
  return proj!.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  for (const k of [KEY_A1, KEY_A2, KEY_B1]) {
    await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(k)}`;
  }
  await deleteTestOrg(ORG_A);
  await deleteTestOrg(ORG_B);
  orgAId = await createTestOrg(ORG_A);
  orgBId = await createTestOrg(ORG_B);
  projA1 = await makeProject(KEY_A1, 'Usage A1', orgAId);
  projA2 = await makeProject(KEY_A2, 'Usage A2', orgAId);
  projB1 = await makeProject(KEY_B1, 'Usage B1', orgBId);
});

afterAll(async () => {
  if (!hasDb) return;
  for (const k of [KEY_A1, KEY_A2, KEY_B1]) {
    await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(k)}`;
  }
  await deleteTestOrg(ORG_A); // cascades usage_counters
  await deleteTestOrg(ORG_B);
  await redis.quit();
  await db.end();
});

// Reset counters + the orgs' identities before each test so counts start at zero.
beforeEach(async () => {
  if (!hasDb) return;
  await db`DELETE FROM usage_counters WHERE organization_id IN (${orgAId}, ${orgBId})`;
  for (const p of [projA1, projA2, projB1]) {
    await db`DELETE FROM identities WHERE project_id = ${p}`; // cascades snapshots
  }
  await db`UPDATE organizations SET monthly_resolution_limit = NULL WHERE id IN (${orgAId}, ${orgBId})`;
});

describe.skipIf(!hasDb)('usage metering: counting', () => {
  it('increments the org counter exactly once per committed resolution', async () => {
    await resolveOn(projA1);
    await resolveOn(projA1);
    await resolveOn(projA1);
    expect(await usageCount(orgAId)).toBe(3);
  });

  it('does NOT increment on a deduplicated (identical event_id) resolution', async () => {
    const identityId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    await resolveOn(projA1, { identityId, timestamp });
    await resolveOn(projA1, { identityId, timestamp }); // same event_id → dedup no-op
    expect(await usageCount(orgAId)).toBe(1);
  });

  it('rolls multiple projects in one org into a single org counter', async () => {
    await resolveOn(projA1);
    await resolveOn(projA2);
    expect(await usageCount(orgAId)).toBe(2);
  });

  it('keeps usage isolated per organization', async () => {
    await resolveOn(projA1);
    await resolveOn(projB1);
    await resolveOn(projB1);
    expect(await usageCount(orgAId)).toBe(1);
    expect(await usageCount(orgBId)).toBe(2);
  });
});

describe.skipIf(!hasDb)('usage metering: soft thresholds', () => {
  // Seeds the current-period counter row directly so the threshold logic is tested
  // deterministically (the live path fires checkAndWarnThreshold fire-and-forget).
  async function seedCount(orgId: string, count: number): Promise<void> {
    await db`
      INSERT INTO usage_counters (organization_id, period_start, resolution_count)
      VALUES (${orgId}, ${currentPeriod()}::date, ${count})
      ON CONFLICT (organization_id, period_start)
      DO UPDATE SET resolution_count = ${count}, warned_80 = false, warned_100 = false
    `;
  }
  async function flags(orgId: string): Promise<{ warned_80: boolean; warned_100: boolean }> {
    const [row] = await db<{ warned_80: boolean; warned_100: boolean }[]>`
      SELECT warned_80, warned_100 FROM usage_counters
      WHERE organization_id = ${orgId} AND period_start = ${currentPeriod()}::date
    `;
    return row!;
  }

  it('never warns when the limit is NULL (unlimited / self-host)', async () => {
    await db`UPDATE organizations SET monthly_resolution_limit = NULL WHERE id = ${orgAId}`;
    await seedCount(orgAId, 1_000_000);
    await checkAndWarnThreshold(db, orgAId, 1_000_000);
    expect(await flags(orgAId)).toEqual({ warned_80: false, warned_100: false });
  });

  it('does not warn below 80%', async () => {
    await db`UPDATE organizations SET monthly_resolution_limit = 10 WHERE id = ${orgAId}`;
    await seedCount(orgAId, 7);
    await checkAndWarnThreshold(db, orgAId, 7);
    expect(await flags(orgAId)).toEqual({ warned_80: false, warned_100: false });
  });

  it('flips warned_80 once at 80% and is idempotent', async () => {
    await db`UPDATE organizations SET monthly_resolution_limit = 10 WHERE id = ${orgAId}`;
    await seedCount(orgAId, 8);
    await checkAndWarnThreshold(db, orgAId, 8);
    expect(await flags(orgAId)).toEqual({ warned_80: true, warned_100: false });
    // Idempotent: a second call at the same level doesn't reset or re-flip.
    await checkAndWarnThreshold(db, orgAId, 8);
    expect(await flags(orgAId)).toEqual({ warned_80: true, warned_100: false });
  });

  it('flips both guards at 100%', async () => {
    await db`UPDATE organizations SET monthly_resolution_limit = 10 WHERE id = ${orgAId}`;
    await seedCount(orgAId, 12);
    await checkAndWarnThreshold(db, orgAId, 12);
    expect(await flags(orgAId)).toEqual({ warned_80: true, warned_100: true });
  });
});
