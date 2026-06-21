import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { hashApiKey } from '../middleware/api-key.js';
import { assessRisk } from './assess.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Regression coverage for the risk_assessments.flags encoding bug: the insert used
// `${JSON.stringify(flags)}::jsonb`, which postgres.js double-encodes into a JSON
// string scalar instead of an array — breaking /resolve (which spread the string into
// per-character garbage) and yielding a NaN score. The flags column must be a JSON
// ARRAY. Gated on DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);
const API_KEY = 'assess-integration-key';
const ORG = 'Assess IT Org';
const ID = 'assessit-identity-1';

let projectId: string;
let snapshotId: string;

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, organization_id) VALUES (${hashApiKey(API_KEY)}, 'Assess Integration', ${org}) RETURNING id
  `;
  projectId = proj!.id;
  await db`
    INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, snapshot_count)
    VALUES (${ID}, ${projectId}, 'high', 'low', ${db.json({})}, 1)
  `;
  const [snap] = await db<{ id: string }[]>`
    INSERT INTO snapshots (identity_id, project_id, event_id, timestamp, signals, signal_hash, persistence_policy)
    VALUES (${ID}, ${projectId}, ${`${ID}:1`}, now(), ${db.json({})}, 'assesshash', 'balanced')
    RETURNING id
  `;
  snapshotId = snap!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key_hash = ${hashApiKey(API_KEY)}`;
  await deleteTestOrg(ORG);
  await db.end();
});

describe.skipIf(!hasDb)('assessRisk flags encoding (integration)', () => {
  it('stores flags as a JSON array, not a double-encoded string', async () => {
    const result = await assessRisk(db, {
      identityId: ID,
      snapshotId,
      projectId,
      // A tamper signal trips the automation detector, so we get a real flag.
      signals: { 'tamper.devtools_open': true },
      signalHash: 'assesshash',
      clusterId: null,
      clientIp: null,
      timestamp: new Date().toISOString(),
      isNew: false,
    });

    // The score is a real number (the bug produced NaN downstream), and flags is an
    // array of objects with a code.
    expect(typeof result.score).toBe('number');
    expect(Number.isNaN(result.score)).toBe(false);
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.flags.some((f) => f.code === 'automation_suspected')).toBe(true);

    // At rest the column must be a JSON array — this is what regressed.
    const [row] = await db<{ kind: string; len: number }[]>`
      SELECT jsonb_typeof(flags) AS kind, jsonb_array_length(flags) AS len
      FROM risk_assessments WHERE identity_id = ${ID} ORDER BY timestamp DESC LIMIT 1
    `;
    expect(row?.kind).toBe('array');
    expect(row?.len).toBeGreaterThan(0);
  });
});
