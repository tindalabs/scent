import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';

// Encryption key must be set before the app handles a 2FA request (crypto.ts reads it
// fresh each call, so setting it here is enough).
process.env['SCENT_SECRET_KEY'] = 'test-2fa-encryption-key-please-ignore';

const { createApp } = await import('../app.js');
const { migrate } = await import('../db/migrate.js');
const { db } = await import('../db/client.js');
const { redis } = await import('../db/redis.js');
const { hashPassword } = await import('../admin/password.js');
const { createTestOrg, deleteTestOrg } = await import('../test-support/org.js');

// Integration coverage for TOTP 2FA (migration 011): enrollment, login challenge,
// recovery codes, disable, and the org-wide require-2FA enrollment funnel. Gated on
// DATABASE_URL.
const hasDb = Boolean(process.env['DATABASE_URL']);

const OWNER_EMAIL = 'twofa-owner-it@example.com';
const MEMBER_EMAIL = 'twofa-member-it@example.com';
const PASSWORD = 'test-password-123';
const EMAILS = [OWNER_EMAIL, MEMBER_EMAIL];
const ORG = 'TwoFaIT Org';

const app = createApp();

function csrfFrom(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = cookies.find((x) => x.startsWith('scent_csrf='));
  return c ? c.split(';')[0]!.slice('scent_csrf='.length) : '';
}

beforeAll(async () => {
  if (!hasDb) return;
  await migrate();
  await redis.flushdb();
  await db`DELETE FROM admin_users WHERE email = ANY(${EMAILS})`;
  await deleteTestOrg(ORG);
  const org = await createTestOrg(ORG);
  await db`INSERT INTO admin_users (email, password_hash, role, is_active, organization_id) VALUES (${OWNER_EMAIL}, ${await hashPassword(PASSWORD)}, 'owner', true, ${org})`;
  await db`INSERT INTO admin_users (email, password_hash, role, is_active, organization_id) VALUES (${MEMBER_EMAIL}, ${await hashPassword(PASSWORD)}, 'member', true, ${org})`;
});

afterAll(async () => {
  if (!hasDb) return;
  // require_2fa is per-org now, so deleting this suite's org (after its admins) is enough
  // — no other suite's admins can be funneled by it.
  await db`DELETE FROM admin_users WHERE email = ANY(${EMAILS})`;
  await deleteTestOrg(ORG);
  await redis.quit();
  await db.end();
});

describe.skipIf(!hasDb)('admin 2FA (integration)', () => {
  const owner = request.agent(app);
  let ownerCsrf = '';
  let secret = '';
  let recoveryCodes: string[] = [];

  beforeAll(async () => {
    if (!hasDb) return;
    const login = await owner.post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD });
    ownerCsrf = csrfFrom(login.headers['set-cookie']);
  });

  it('enrolls: setup returns a secret, verify enables and returns recovery codes', async () => {
    const setup = await owner.post('/admin/me/2fa/setup').set('X-CSRF-Token', ownerCsrf);
    expect(setup.status).toBe(200);
    expect(typeof setup.body.secret).toBe('string');
    expect(setup.body.otpauthUri).toContain('otpauth://');
    secret = setup.body.secret;

    const bad = await owner.post('/admin/me/2fa/verify').set('X-CSRF-Token', ownerCsrf).send({ code: '000000' });
    expect(bad.status).toBe(400);

    const verify = await owner
      .post('/admin/me/2fa/verify')
      .set('X-CSRF-Token', ownerCsrf)
      .send({ code: authenticator.generate(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.recoveryCodes).toHaveLength(10);
    recoveryCodes = verify.body.recoveryCodes;

    const me = await owner.get('/admin/me');
    expect(me.body.totpEnabled).toBe(true);
  });

  it('requires the second factor at login once enrolled', async () => {
    const noCode = await request(app).post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.twoFactorRequired).toBe(true);

    const withCode = await request(app)
      .post('/admin/login')
      .send({ email: OWNER_EMAIL, password: PASSWORD, totpCode: authenticator.generate(secret) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.email).toBe(OWNER_EMAIL);
  });

  it('accepts a recovery code at login, and only once', async () => {
    const code = recoveryCodes[0]!;
    const first = await request(app).post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD, recoveryCode: code });
    expect(first.status).toBe(200);

    const reuse = await request(app).post('/admin/login').send({ email: OWNER_EMAIL, password: PASSWORD, recoveryCode: code });
    expect(reuse.status).toBe(401);
  });

  it('funnels un-enrolled admins into enrollment when the install requires 2FA', async () => {
    const member = request.agent(app);
    const login = await member.post('/admin/login').send({ email: MEMBER_EMAIL, password: PASSWORD });
    expect(login.status).toBe(200); // login still issues a session so they CAN enroll
    const memberCsrf = csrfFrom(login.headers['set-cookie']);

    // Owner turns on the requirement.
    const toggle = await owner.put('/admin/settings').set('X-CSRF-Token', ownerCsrf).send({ require_2fa: true });
    expect(toggle.status).toBe(200);

    // Member is now blocked from normal routes but /me still works and flags mustEnroll.
    const blocked = await member.get('/admin/projects');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('two_factor_enrollment_required');
    const me = await member.get('/admin/me');
    expect(me.body.mustEnroll).toBe(true);

    // After enrolling, the member is unblocked.
    const setup = await member.post('/admin/me/2fa/setup').set('X-CSRF-Token', memberCsrf);
    await member.post('/admin/me/2fa/verify').set('X-CSRF-Token', memberCsrf).send({ code: authenticator.generate(setup.body.secret) });
    const unblocked = await member.get('/admin/projects');
    expect(unblocked.status).toBe(200);
  });

  it('disables 2FA after a password re-auth', async () => {
    const wrong = await owner.post('/admin/me/2fa/disable').set('X-CSRF-Token', ownerCsrf).send({ password: 'nope' });
    expect(wrong.status).toBe(403);

    const ok = await owner.post('/admin/me/2fa/disable').set('X-CSRF-Token', ownerCsrf).send({ password: PASSWORD });
    expect(ok.status).toBe(200);

    const me = await owner.get('/admin/me');
    expect(me.body.totpEnabled).toBe(false);
  });
});
