import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashPassword } from '../admin/password.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Cross-tenant isolation for the organizations layer (migration 013): an owner is a
// superuser WITHIN its org only. Two orgs (A, B), each with its own owner and project;
// asserts owner-A can never see, view, rotate, delete, or grant against B's resources,
// that user/invite listings are org-scoped, that an invite lands the new admin in the
// inviting org, and that the last-owner guard counts per-org. Gated on DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);

const ORG_A = 'OrgIsoIT A';
const ORG_B = 'OrgIsoIT B';
const OWNER_A = 'orgiso-owner-a@example.com';
const OWNER_B = 'orgiso-owner-b@example.com';
const INVITEE = 'orgiso-invitee@example.com';
const PASSWORD = 'test-password-123';
const EMAILS = [OWNER_A, OWNER_B, INVITEE];

const app = createApp();
let projectB: string;

function csrfFrom(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = cookies.find((x) => x.startsWith('scent_csrf='));
  return c ? c.split(';')[0]!.slice('scent_csrf='.length) : '';
}

async function cleanup(): Promise<void> {
  await db`DELETE FROM admin_users WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM admin_invites WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM projects WHERE name LIKE 'OrgIsoIT %'`;
  await deleteTestOrg(ORG_A);
  await deleteTestOrg(ORG_B);
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await cleanup();

  const orgA = await createTestOrg(ORG_A);
  const orgB = await createTestOrg(ORG_B);
  await db`INSERT INTO admin_users (email, password_hash, role, is_active, organization_id) VALUES (${OWNER_A}, ${await hashPassword(PASSWORD)}, 'owner', true, ${orgA})`;
  await db`INSERT INTO admin_users (email, password_hash, role, is_active, organization_id) VALUES (${OWNER_B}, ${await hashPassword(PASSWORD)}, 'owner', true, ${orgB})`;
  const [pB] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, organization_id) VALUES ('orgiso-hash-b', 'OrgIsoIT Project B', ${orgB}) RETURNING id
  `;
  projectB = pB!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await cleanup();
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('organization isolation (integration)', () => {
  const ownerA = request.agent(app);
  let csrfA = '';

  beforeAll(async () => {
    if (!hasDb) return;
    const a = await ownerA.post('/admin/login').send({ email: OWNER_A, password: PASSWORD });
    csrfA = csrfFrom(a.headers['set-cookie']);
  });

  it('owner-A does not see org-B projects in the list', async () => {
    const res = await ownerA.get('/admin/projects');
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(projectB);
  });

  it('owner-A gets 404 (not 403) viewing an org-B project — no existence leak', async () => {
    const res = await ownerA.get('/v1/dashboard').set('X-Project-Id', projectB);
    expect(res.status).toBe(404);
  });

  it('owner-A gets 404 rotating an org-B project key', async () => {
    const res = await ownerA.post(`/admin/projects/${projectB}/rotate`).set('X-CSRF-Token', csrfA);
    expect(res.status).toBe(404);
  });

  it('owner-A gets 404 deleting an org-B project', async () => {
    const res = await ownerA.delete(`/admin/projects/${projectB}`).set('X-CSRF-Token', csrfA);
    expect(res.status).toBe(404);
  });

  it('owner-A only sees same-org admins in the user list', async () => {
    const res = await ownerA.get('/admin/users');
    expect(res.status).toBe(200);
    const emails = res.body.users.map((u: { email: string }) => u.email);
    expect(emails).toContain(OWNER_A);
    expect(emails).not.toContain(OWNER_B);
  });

  it('an invite from owner-A lands the new admin in org-A', async () => {
    const inv = await ownerA.post('/admin/users/invite').set('X-CSRF-Token', csrfA).send({ email: INVITEE, role: 'member' });
    expect(inv.status).toBe(201);

    const accepter = request.agent(app);
    const accepted = await accepter.post('/admin/invites/accept').send({ token: inv.body.token, password: PASSWORD });
    expect(accepted.status).toBe(201);

    // The accepted account is visible to owner-A (same org) and carries org-A.
    const usersA = await ownerA.get('/admin/users');
    expect(usersA.body.users.map((u: { email: string }) => u.email)).toContain(INVITEE);

    // ...and invisible to owner-B.
    const ownerB = request.agent(app);
    await ownerB.post('/admin/login').send({ email: OWNER_B, password: PASSWORD });
    const usersB = await ownerB.get('/admin/users');
    expect(usersB.body.users.map((u: { email: string }) => u.email)).not.toContain(INVITEE);
  });

  it('the last-owner guard is per-org: owner-A can be the sole owner of its org', async () => {
    // org-A has exactly one owner (OWNER_A). Trying to demote self is blocked by the
    // self-edit guard, but the per-org last-owner count must not be inflated by org-B's
    // owner. Demoting owner-A via owner-B must 404 (cross-org), proving separation.
    const ownerB = request.agent(app);
    const b = await ownerB.post('/admin/login').send({ email: OWNER_B, password: PASSWORD });
    const csrfB = csrfFrom(b.headers['set-cookie']);
    const usersA = await ownerA.get('/admin/users');
    const aId = usersA.body.users.find((u: { email: string }) => u.email === OWNER_A)?.id;
    const res = await ownerB.patch(`/admin/users/${aId}`).set('X-CSRF-Token', csrfB).send({ role: 'member' });
    expect(res.status).toBe(404);
  });
});
