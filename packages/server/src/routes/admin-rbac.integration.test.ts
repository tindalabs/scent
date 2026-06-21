import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashApiKey } from '../middleware/api-key.js';
import { hashPassword } from '../admin/password.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Integration coverage for the two-level admin RBAC (migration 009): owners are
// superusers; members reach only the projects granted in project_members, and their
// per-project role (admin vs viewer) gates manage-vs-read. Gated on DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);

const OWNER_EMAIL = 'rbac-owner-it@example.com';
const MEMBER_EMAIL = 'rbac-member-it@example.com';
const PASSWORD = 'test-password-123';
const KEY_A = 'rbac-it-key-a';
const KEY_B = 'rbac-it-key-b';
const KEY_C = 'rbac-it-key-c';
const ORG = 'RbacIT Org';

const app = createApp();
let idA: string; // member: viewer
let idB: string; // member: admin
let idC: string; // member: no membership

// Pull the double-submit CSRF token out of a Set-Cookie header.
function csrfFrom(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = cookies.find((x) => x.startsWith('scent_csrf='));
  return c ? c.split(';')[0]!.slice('scent_csrf='.length) : '';
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM admin_users WHERE email IN (${OWNER_EMAIL}, ${MEMBER_EMAIL})`;
  await db`DELETE FROM projects WHERE name LIKE 'RbacIT %'`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);

  await db`
    INSERT INTO admin_users (email, password_hash, role, organization_id)
    VALUES (${OWNER_EMAIL}, ${await hashPassword(PASSWORD)}, 'owner', ${org})
  `;
  const [member] = await db<{ id: string }[]>`
    INSERT INTO admin_users (email, password_hash, role, organization_id)
    VALUES (${MEMBER_EMAIL}, ${await hashPassword(PASSWORD)}, 'member', ${org}) RETURNING id
  `;

  const mk = async (key: string, name: string): Promise<string> => {
    const [p] = await db<{ id: string }[]>`
      INSERT INTO projects (api_key_hash, name, organization_id) VALUES (${hashApiKey(key)}, ${name}, ${org}) RETURNING id
    `;
    return p!.id;
  };
  idA = await mk(KEY_A, 'RbacIT A');
  idB = await mk(KEY_B, 'RbacIT B');
  idC = await mk(KEY_C, 'RbacIT C');

  // Grant the member: viewer on A, admin on B, nothing on C.
  await db`INSERT INTO project_members (user_id, project_id, role) VALUES (${member!.id}, ${idA}, 'viewer')`;
  await db`INSERT INTO project_members (user_id, project_id, role) VALUES (${member!.id}, ${idB}, 'admin')`;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM admin_users WHERE email IN (${OWNER_EMAIL}, ${MEMBER_EMAIL})`;
  await db`DELETE FROM projects WHERE name LIKE 'RbacIT %'`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('admin RBAC (integration)', () => {
  const owner = request.agent(app);
  const member = request.agent(app);
  let memberCsrf = '';
  let ownerCsrf = '';

  beforeAll(async () => {
    if (!hasDb) return;
    const o = await owner.post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD });
    ownerCsrf = csrfFrom(o.headers['set-cookie']);
    const m = await member.post('/admin/login').send({ email: MEMBER_EMAIL, password: PASSWORD });
    memberCsrf = csrfFrom(m.headers['set-cookie']);
    expect(o.body.role).toBe('owner');
    expect(m.body.role).toBe('member');
  });

  it('exposes the role via /admin/me', async () => {
    const me = await member.get('/admin/me');
    expect(me.body.role).toBe('member');
  });

  it('scopes the project list to the member\'s grants, with per-project role', async () => {
    const res = await member.get('/admin/projects');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.projects.map((p: { id: string; role: string }) => [p.id, p.role]));
    expect(byId[idA]).toBe('viewer');
    expect(byId[idB]).toBe('admin');
    expect(byId[idC]).toBeUndefined(); // not granted
    expect(res.body.projects).toHaveLength(2);
  });

  it('lets an owner see all three projects', async () => {
    const res = await owner.get('/admin/projects');
    const ids = res.body.projects.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([idA, idB, idC]));
  });

  it('lets a member read data for a granted project (viewer)', async () => {
    const res = await member.get('/v1/dashboard').set('X-Project-Id', idA);
    expect(res.status).toBe(200);
  });

  it('forbids a member reading a project they were not granted (403)', async () => {
    const res = await member.get('/v1/dashboard').set('X-Project-Id', idC);
    expect(res.status).toBe(403);
  });

  it('lets a project-admin member rotate that project\'s key', async () => {
    const res = await member.post(`/admin/projects/${idB}/rotate`).set('X-CSRF-Token', memberCsrf);
    expect(res.status).toBe(200);
    expect(typeof res.body.apiKey).toBe('string');
  });

  it('forbids a viewer member rotating a key (403)', async () => {
    const res = await member.post(`/admin/projects/${idA}/rotate`).set('X-CSRF-Token', memberCsrf);
    expect(res.status).toBe(403);
  });

  it('forbids a member creating a project (owner-only, 403)', async () => {
    const res = await member.post('/admin/projects').set('X-CSRF-Token', memberCsrf).send({ name: 'RbacIT Nope' });
    expect(res.status).toBe(403);
  });

  it('forbids a member deleting a project (owner-only, 403)', async () => {
    const res = await member.delete(`/admin/projects/${idB}`).set('X-CSRF-Token', memberCsrf);
    expect(res.status).toBe(403);
  });

  it('lets an owner create and delete a project', async () => {
    const created = await owner.post('/admin/projects').set('X-CSRF-Token', ownerCsrf).send({ name: 'RbacIT Owner' });
    expect(created.status).toBe(201);
    const del = await owner.delete(`/admin/projects/${created.body.project.id}`).set('X-CSRF-Token', ownerCsrf);
    expect(del.status).toBe(200);
  });
});
