import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { hashPassword } from '../admin/password.js';
import { createTestOrg, deleteTestOrg } from '../test-support/org.js';

// Integration coverage for account management (migration 010): invite + accept,
// owner-only gating, self-lockout guard, per-project membership grants, self password
// change, and deactivation (session revocation + login block). Gated on DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);

const OWNER_EMAIL = 'acct-owner-it@example.com';
const MEMBER_EMAIL = 'acct-member-it@example.com';
const SHORTPW_EMAIL = 'acct-shortpw-it@example.com';
const PASSWORD = 'test-password-123';
const NEW_PASSWORD = 'new-password-456';
const ORG = 'AcctIT Org';

const app = createApp();
let ownerId: string;

function csrfFrom(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = cookies.find((x) => x.startsWith('scent_csrf='));
  return c ? c.split(';')[0]!.slice('scent_csrf='.length) : '';
}

const EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, SHORTPW_EMAIL];

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM admin_users WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM admin_invites WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM projects WHERE name LIKE 'AcctIT %'`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  const [owner] = await db<{ id: string }[]>`
    INSERT INTO admin_users (email, password_hash, role, is_active, organization_id)
    VALUES (${OWNER_EMAIL}, ${await hashPassword(PASSWORD)}, 'owner', true, ${org}) RETURNING id
  `;
  ownerId = owner!.id;
});

afterAll(async () => {
  if (!hasDb) return;
  await db`DELETE FROM admin_users WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM admin_invites WHERE email = ANY(${EMAILS})`;
  await db`DELETE FROM projects WHERE name LIKE 'AcctIT %'`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('admin account management (integration)', () => {
  const owner = request.agent(app);
  const member = request.agent(app);
  let ownerCsrf = '';
  let memberCsrf = '';
  let memberId = '';
  let projectId = '';

  beforeAll(async () => {
    if (!hasDb) return;
    const login = await owner.post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD });
    ownerCsrf = csrfFrom(login.headers['set-cookie']);
  });

  it('owner invites a member; accepting creates the account and logs in', async () => {
    const inv = await owner.post('/admin/users/invite').set('X-CSRF-Token', ownerCsrf).send({ email: MEMBER_EMAIL });
    expect(inv.status).toBe(201);
    expect(typeof inv.body.token).toBe('string');
    expect(inv.body.invite.email).toBe(MEMBER_EMAIL);

    const peek = await request(app).get('/admin/invites/accept').query({ token: inv.body.token });
    expect(peek.status).toBe(200);
    expect(peek.body).toMatchObject({ email: MEMBER_EMAIL, role: 'member' });

    const accept = await member.post('/admin/invites/accept').send({ token: inv.body.token, password: PASSWORD });
    expect(accept.status).toBe(201);
    expect(accept.body).toMatchObject({ email: MEMBER_EMAIL, role: 'member' });
    memberCsrf = csrfFrom(accept.headers['set-cookie']);

    const me = await member.get('/admin/me');
    expect(me.body).toMatchObject({ email: MEMBER_EMAIL, role: 'member' });

    const row = await db<{ id: string }[]>`SELECT id FROM admin_users WHERE email = ${MEMBER_EMAIL} LIMIT 1`;
    memberId = row[0]!.id;

    // The token is single-use.
    const reuse = await request(app).post('/admin/invites/accept').send({ token: inv.body.token, password: PASSWORD });
    expect(reuse.status).toBe(410);
  });

  it('rejects an invalid token and a too-short password', async () => {
    const bad = await request(app).get('/admin/invites/accept').query({ token: 'nope' });
    expect(bad.status).toBe(410);

    const inv = await owner.post('/admin/users/invite').set('X-CSRF-Token', ownerCsrf).send({ email: SHORTPW_EMAIL });
    const short = await request(app).post('/admin/invites/accept').send({ token: inv.body.token, password: 'short' });
    expect(short.status).toBe(400);
  });

  it('rejects inviting an email that already has an account (409)', async () => {
    const dup = await owner.post('/admin/users/invite').set('X-CSRF-Token', ownerCsrf).send({ email: MEMBER_EMAIL });
    expect(dup.status).toBe(409);
  });

  it('forbids a member from listing users or inviting (owner-only, 403)', async () => {
    expect((await member.get('/admin/users')).status).toBe(403);
    const inv = await member.post('/admin/users/invite').set('X-CSRF-Token', memberCsrf).send({ email: 'x@example.com' });
    expect(inv.status).toBe(403);
  });

  it('lists users and pending invites for an owner', async () => {
    const res = await owner.get('/admin/users');
    expect(res.status).toBe(200);
    const emails = res.body.users.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining([OWNER_EMAIL, MEMBER_EMAIL]));
  });

  it('forbids changing your own role/status (self-lockout guard, 400)', async () => {
    const res = await owner.patch(`/admin/users/${ownerId}`).set('X-CSRF-Token', ownerCsrf).send({ is_active: false });
    expect(res.status).toBe(400);
  });

  it('grants, upgrades, and revokes per-project membership', async () => {
    const proj = await owner.post('/admin/projects').set('X-CSRF-Token', ownerCsrf).send({ name: 'AcctIT P' });
    projectId = proj.body.project.id;

    // viewer: can read, cannot rotate.
    await owner.put(`/admin/users/${memberId}/projects/${projectId}`).set('X-CSRF-Token', ownerCsrf).send({ role: 'viewer' });
    expect((await member.get('/v1/dashboard').set('X-Project-Id', projectId)).status).toBe(200);
    expect((await member.post(`/admin/projects/${projectId}/rotate`).set('X-CSRF-Token', memberCsrf)).status).toBe(403);

    const listed = await owner.get(`/admin/users/${memberId}/projects`);
    expect(listed.body.memberships).toHaveLength(1);
    expect(listed.body.memberships[0]).toMatchObject({ project_id: projectId, role: 'viewer' });

    // upgrade to admin: can now rotate.
    await owner.put(`/admin/users/${memberId}/projects/${projectId}`).set('X-CSRF-Token', ownerCsrf).send({ role: 'admin' });
    expect((await member.post(`/admin/projects/${projectId}/rotate`).set('X-CSRF-Token', memberCsrf)).status).toBe(200);

    // revoke: loses access.
    await owner.delete(`/admin/users/${memberId}/projects/${projectId}`).set('X-CSRF-Token', ownerCsrf);
    expect((await member.get('/v1/dashboard').set('X-Project-Id', projectId)).status).toBe(403);
  });

  it('lets a user change their own password (and rejects a wrong current)', async () => {
    const wrong = await member
      .post('/admin/me/password')
      .set('X-CSRF-Token', memberCsrf)
      .send({ currentPassword: 'nope', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(403);

    const ok = await member
      .post('/admin/me/password')
      .set('X-CSRF-Token', memberCsrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);

    // New password works on a fresh login.
    const relogin = await request(app).post('/admin/login').send({ email: MEMBER_EMAIL, password: NEW_PASSWORD });
    expect(relogin.status).toBe(200);
  });

  it('deactivation revokes the session immediately and blocks login', async () => {
    const deactivate = await owner.patch(`/admin/users/${memberId}`).set('X-CSRF-Token', ownerCsrf).send({ is_active: false });
    expect(deactivate.status).toBe(200);

    // The member's existing session is now rejected.
    expect((await member.get('/admin/me')).status).toBe(401);
    // And they can't log back in.
    const login = await request(app).post('/admin/login').send({ email: MEMBER_EMAIL, password: NEW_PASSWORD });
    expect(login.status).toBe(403);
  });
});
