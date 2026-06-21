import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { sweepRetention } from './retention.js';
import { hashApiKey } from '../middleware/api-key.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Gated on DATABASE_URL like the other integration suites (runs in CI, skips locally
// without a DB). See events.integration.test.ts for the rationale.
const hasDb = Boolean(process.env['DATABASE_URL']);
const API_KEY = 'retention-test-key';
const ORG = 'Retention IT Org';

let projectId: string; // retention_days = 30
let orgId: string;

async function seedIdentity(project: string, ageDays: number): Promise<string> {
  const id = `ret-${ageDays}d-${crypto.randomUUID()}`;
  await db`
    INSERT INTO identities (id, project_id, last_seen)
    VALUES (${id}, ${project}, now() - make_interval(days => ${ageDays}))
  `;
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await db`DELETE FROM projects WHERE api_key_hash IN (${hashApiKey(API_KEY)}, ${hashApiKey(`${API_KEY}-keep`)})`;
  await deleteTestOrg(ORG);
  orgId = await createTestOrg(ORG);
  const [proj] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, retention_days, organization_id)
    VALUES (${hashApiKey(API_KEY)}, 'Retention Test', 30, ${orgId}) RETURNING id
  `;
  projectId = proj!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM projects WHERE api_key_hash IN (${hashApiKey(API_KEY)}, ${hashApiKey(`${API_KEY}-keep`)})`;
  await deleteTestOrg(ORG);
  await db.end();
});

describe.skipIf(!hasDb)('sweepRetention', () => {
  it('deletes identities older than retention_days and keeps recent ones', async () => {
    const stale = await seedIdentity(projectId, 60); // older than 30d → swept
    const fresh = await seedIdentity(projectId, 1); // within 30d → kept

    const result = await sweepRetention(db);
    expect(result.identitiesDeleted).toBeGreaterThanOrEqual(1);

    const rows = await db<{ id: string }[]>`
      SELECT id FROM identities WHERE project_id = ${projectId}
    `;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(stale);
  });

  it('skips projects with null retention_days (keep forever)', async () => {
    const [keepProj] = await db<{ id: string }[]>`
      INSERT INTO projects (api_key_hash, name, organization_id)
      VALUES (${hashApiKey(`${API_KEY}-keep`)}, 'Keep Forever', ${orgId}) RETURNING id
    `;
    const ancient = await seedIdentity(keepProj!.id, 999);

    await sweepRetention(db);

    const rows = await db<{ id: string }[]>`SELECT id FROM identities WHERE id = ${ancient}`;
    expect(rows.length).toBe(1); // untouched — retention_days is null
  });
});
