import { Router, type Request, type Response, type IRouter, type CookieOptions } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { mintApiKey } from '../lib/api-key.js';
import { hashPassword, verifyPassword } from '../admin/password.js';
import {
  createSession,
  deleteSession,
  deleteSessionsForUser,
  deleteOtherSessions,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from '../admin/session.js';
import { createInvite, findValidInvite, markInviteAccepted } from '../admin/invite.js';
import { requireAdmin } from '../admin/middleware.js';
import { requireOwner, canManageProject } from '../admin/authz.js';
import { issueCsrfToken, clearCsrfToken, requireCsrf } from '../admin/csrf.js';
import { cookieSecure } from '../admin/cookies.js';
import { generateTotpSecret, totpKeyUri, verifyTotp, generateRecoveryCodes, hashRecoveryCode } from '../admin/totp.js';
import { encrypt, decrypt, isEncryptionConfigured } from '../admin/crypto.js';
import { isTwoFactorRequired, setTwoFactorRequired } from '../admin/settings.js';
import { enforce2faEnrollment } from '../admin/enforce-2fa.js';

export const adminRouter: IRouter = Router();

// HttpOnly so JS can't read it; SameSite=Lax blocks cross-site POST (CSRF) while
// allowing same-site navigation; Secure when the request is HTTPS (see cookieSecure),
// so production stays Secure while the plain-HTTP localhost dev stack still works.
function sessionCookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

// Per-IP login throttle to blunt brute force: 10 attempts / minute.
const LOGIN_WINDOW_SECONDS = 60;
const LOGIN_MAX_ATTEMPTS = 10;

async function loginRateLimited(ip: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (LOGIN_WINDOW_SECONDS * 1000));
  const key = `adminlogin:${ip}:${window}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, LOGIN_WINDOW_SECONDS);
  return count > LOGIN_MAX_ATTEMPTS;
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  recoveryCode: z.string().optional(),
});

// Verify a 2FA challenge for an enrolled user: a TOTP code, or a one-time recovery
// code (consumed on use). Returns false if neither is valid.
async function verifyTwoFactor(
  userId: string,
  secretEnc: string | null,
  totpCode?: string,
  recoveryCode?: string,
): Promise<boolean> {
  if (recoveryCode) {
    const used = await db<{ id: string }[]>`
      UPDATE admin_recovery_codes SET used_at = now()
      WHERE user_id = ${userId} AND code_hash = ${hashRecoveryCode(recoveryCode)} AND used_at IS NULL
      RETURNING id
    `;
    return used.length > 0;
  }
  if (totpCode && secretEnc && isEncryptionConfigured()) {
    try {
      return verifyTotp(totpCode, decrypt(secretEnc));
    } catch {
      return false;
    }
  }
  return false;
}

adminRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const ip = req.ip ?? 'unknown';
  if (await loginRateLimited(ip)) {
    res.status(429).json({ error: 'Too many login attempts' });
    return;
  }

  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const rows = await db<
    { id: string; password_hash: string; role: string; is_active: boolean; totp_enabled: boolean; totp_secret_enc: string | null; organization_id: string }[]
  >`
    SELECT id, password_hash, role, is_active, totp_enabled, totp_secret_enc, organization_id
    FROM admin_users WHERE email = ${email} LIMIT 1
  `;

  // Generic failure for both unknown-email and wrong-password (no enumeration).
  const user = rows[0];
  const ok = user ? await verifyPassword(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  // Only revealed after the password checks out, so it doesn't leak account existence.
  if (!user.is_active) {
    res.status(403).json({ error: 'Account is disabled' });
    return;
  }

  // Second factor for enrolled users. Not-yet-enrolled users are let in (so they can
  // enroll); enforce2faEnrollment then funnels them if the install requires 2FA.
  if (user.totp_enabled) {
    const passed2fa = await verifyTwoFactor(user.id, user.totp_secret_enc, parsed.data.totpCode, parsed.data.recoveryCode);
    if (!passed2fa) {
      const tried = Boolean(parsed.data.totpCode || parsed.data.recoveryCode);
      res.status(401).json({ error: tried ? 'Invalid two-factor code' : 'Two-factor code required', twoFactorRequired: true });
      return;
    }
  }

  const token = await createSession(user.id);
  await db`UPDATE admin_users SET last_login_at = now() WHERE id = ${user.id}`;
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
  issueCsrfToken(req, res); // double-submit token for subsequent mutations
  const mustEnroll = !user.totp_enabled && (await isTwoFactorRequired(user.organization_id));
  res.json({ id: user.id, email, role: user.role, totpEnabled: user.totp_enabled, mustEnroll });
});

adminRouter.post('/logout', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: undefined });
  clearCsrfToken(req, res);
  res.json({ ok: true });
});

// --- Invite acceptance (PUBLIC: no session — the invitee has no account yet) ------
// Rate-limited by the /admin mount. The opaque token is the credential.

// Look up a pending invite so the accept page can show which email it's for.
adminRouter.get('/invites/accept', async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
  const invite = token ? await findValidInvite(token) : null;
  if (!invite) {
    res.status(410).json({ error: 'This invite is invalid or has expired' });
    return;
  }
  res.json({ email: invite.email, role: invite.role });
});

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

// Accept an invite: create the account with the invited role and log them in.
adminRouter.post('/invites/accept', async (req: Request, res: Response): Promise<void> => {
  const parsed = AcceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload (password must be at least 8 characters)' });
    return;
  }

  const invite = await findValidInvite(parsed.data.token);
  if (!invite) {
    res.status(410).json({ error: 'This invite is invalid or has expired' });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db<{ id: string }[]>`
    INSERT INTO admin_users (email, password_hash, role, is_active, organization_id)
    VALUES (${invite.email}, ${passwordHash}, ${invite.role}, true, ${invite.organization_id})
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;
  if (!user) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  await markInviteAccepted(invite.id);

  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
  issueCsrfToken(req, res);
  const mustEnroll = await isTwoFactorRequired(invite.organization_id);
  res.status(201).json({ id: user.id, email: invite.email, role: invite.role, totpEnabled: false, mustEnroll });
});

// Everything below requires a valid admin session. Mutating routes additionally
// require the CSRF token (GETs don't need it).
adminRouter.use(requireAdmin);
// If the install requires 2FA, block not-yet-enrolled admins from everything except
// enrollment + session management (see enforce-2fa.ts).
adminRouter.use(enforce2faEnrollment);

adminRouter.get('/me', async (req: Request, res: Response): Promise<void> => {
  const user = req.adminUser!;
  const mustEnroll = !user.totpEnabled && (await isTwoFactorRequired(user.organizationId));
  res.json({ id: user.id, email: user.email, role: user.role, totpEnabled: user.totpEnabled, mustEnroll });
});

// Usage metering for the caller's organization: current-month resolution count vs the
// soft limit, plus recent history. Org-scoped (any admin sees their own org's usage);
// GET, so no CSRF. limit null = unlimited (self-host / un-provisioned).
adminRouter.get('/usage', async (req: Request, res: Response): Promise<void> => {
  const org = req.adminUser!.organizationId;
  const [orgRow] = await db<{ plan: string; monthly_resolution_limit: number | null }[]>`
    SELECT plan, monthly_resolution_limit FROM organizations WHERE id = ${org} LIMIT 1
  `;
  const history = await db<{ period_start: string; resolution_count: string }[]>`
    SELECT to_char(period_start, 'YYYY-MM-DD') AS period_start, resolution_count
    FROM usage_counters
    WHERE organization_id = ${org}
    ORDER BY period_start DESC
    LIMIT 6
  `;

  const now = new Date();
  const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const resolutionsThisPeriod = Number(
    history.find((h) => h.period_start === periodStart)?.resolution_count ?? 0,
  );
  const limit = orgRow?.monthly_resolution_limit ?? null;

  res.json({
    plan: orgRow?.plan ?? 'free',
    limit,
    periodStart,
    resolutionsThisPeriod,
    pctUsed: limit && limit > 0 ? resolutionsThisPeriod / limit : null,
    history: history.map((h) => ({ periodStart: h.period_start, resolutions: Number(h.resolution_count) })),
  });
});

adminRouter.get('/projects', async (req: Request, res: Response): Promise<void> => {
  const user = req.adminUser!;
  // Owners see every project (with the synthetic role 'owner'); members see only the
  // projects granted to them in project_members, tagged with their per-project role.
  const projects = user.role === 'owner'
    ? await db`
        SELECT id, name, key_prefix, created_at, 'owner' AS role
        FROM projects
        WHERE organization_id = ${user.organizationId}
        ORDER BY created_at DESC
      `
    : await db`
        SELECT p.id, p.name, p.key_prefix, p.created_at, pm.role
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${user.id}
        ORDER BY p.created_at DESC
      `;
  res.json({ projects });
});

const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) });

adminRouter.post('/projects', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const { apiKey, keyHash, keyPrefix } = mintApiKey();
  const [project] = await db<{ id: string; name: string; key_prefix: string; created_at: Date }[]>`
    INSERT INTO projects (api_key_hash, name, key_prefix, organization_id)
    VALUES (${keyHash}, ${parsed.data.name}, ${keyPrefix}, ${req.adminUser!.organizationId})
    RETURNING id, name, key_prefix, created_at
  `;

  // apiKey is returned exactly once — it's not recoverable later.
  res.status(201).json({ project, apiKey });
});

adminRouter.post('/projects/:id/rotate', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Missing project id' });
    return;
  }
  // Org-scoped existence check: a project in another tenant is indistinguishable from a
  // missing one (404, never 403 — no cross-tenant existence leak).
  const existing = await db<{ api_key_hash: string }[]>`
    SELECT api_key_hash FROM projects
    WHERE id = ${id} AND organization_id = ${req.adminUser!.organizationId} LIMIT 1
  `;
  if (!existing[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // Rotating keys is a manage action: owner or the project's 'admin' member.
  if (!(await canManageProject(req.adminUser!, id))) {
    res.status(403).json({ error: 'You do not have permission to manage this project' });
    return;
  }

  const { apiKey, keyHash, keyPrefix } = mintApiKey();
  await db`
    UPDATE projects SET api_key_hash = ${keyHash}, key_prefix = ${keyPrefix} WHERE id = ${id}
  `;
  // Kill the old key immediately rather than waiting out the auth-cache TTL.
  await redis.del(`proj:${existing[0].api_key_hash}`);

  res.json({ apiKey });
});

// Deleting a project cascades all of its identities/snapshots — an irreversible,
// install-level action, so it's owner-only (a project 'admin' can rotate but not drop).
adminRouter.delete('/projects/:id', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Missing project id' });
    return;
  }
  const existing = await db<{ api_key_hash: string }[]>`
    SELECT api_key_hash FROM projects
    WHERE id = ${id} AND organization_id = ${req.adminUser!.organizationId} LIMIT 1
  `;
  if (!existing[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  await db`DELETE FROM projects WHERE id = ${id}`; // cascades identities/snapshots/etc.
  await redis.del(`proj:${existing[0].api_key_hash}`);

  res.json({ deleted: true });
});

// --- Self-service ------------------------------------------------------------------

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

// Any signed-in admin can change their own password. Verifies the current one, then
// revokes the user's OTHER sessions (keeps this one) so other devices are logged out.
adminRouter.post('/me/password', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload (new password must be at least 8 characters)' });
    return;
  }
  const userId = req.adminUser!.id;
  const rows = await db<{ password_hash: string }[]>`
    SELECT password_hash FROM admin_users WHERE id = ${userId} LIMIT 1
  `;
  const ok = rows[0] ? await verifyPassword(parsed.data.currentPassword, rows[0].password_hash) : false;
  if (!ok) {
    res.status(403).json({ error: 'Current password is incorrect' });
    return;
  }
  await db`UPDATE admin_users SET password_hash = ${await hashPassword(parsed.data.newPassword)} WHERE id = ${userId}`;
  const currentToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (currentToken) await deleteOtherSessions(userId, currentToken);
  res.json({ ok: true });
});

// --- Account management (owner-only) -----------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// List admins and pending invites.
adminRouter.get('/users', requireOwner, async (req: Request, res: Response): Promise<void> => {
  const org = req.adminUser!.organizationId;
  const users = await db`
    SELECT id, email, role, is_active, totp_enabled, last_login_at, created_at
    FROM admin_users WHERE organization_id = ${org} ORDER BY created_at ASC
  `;
  const invites = await db`
    SELECT id, email, role, expires_at, created_at
    FROM admin_invites
    WHERE organization_id = ${org} AND accepted_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
  `;
  res.json({ users, invites });
});

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member']).default('member'),
});

// Mint an invite. The raw token is returned exactly once; the Observatory builds the
// accept-link from it. Rejected if an account with that email already exists.
adminRouter.post('/users/invite', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const parsed = InviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await db`SELECT id FROM admin_users WHERE email = ${email} LIMIT 1`;
  if (existing[0]) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }
  const { token, invite } = await createInvite(email, parsed.data.role, req.adminUser!.id, req.adminUser!.organizationId);
  res.status(201).json({ invite, token });
});

const UpdateUserSchema = z
  .object({ role: z.enum(['owner', 'member']).optional(), is_active: z.boolean().optional() })
  .refine((d) => d.role !== undefined || d.is_active !== undefined, { message: 'Nothing to update' });

// Change a user's role and/or active status. Guards against self-lockout and against
// removing the last active owner. Deactivating revokes the user's sessions at once.
adminRouter.patch('/users/:id', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  if (id === req.adminUser!.id) {
    res.status(400).json({ error: 'You cannot change your own role or status' });
    return;
  }
  const org = req.adminUser!.organizationId;
  // Org-scoped lookup: a user in another tenant reads as not-found (no cross-org edits).
  const target = await db<{ id: string; role: string; is_active: boolean }[]>`
    SELECT id, role, is_active FROM admin_users WHERE id = ${id} AND organization_id = ${org} LIMIT 1
  `;
  if (!target[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Don't strip the ORG of its last active owner (demote or deactivate).
  const losingOwner =
    target[0].role === 'owner' &&
    ((parsed.data.role !== undefined && parsed.data.role !== 'owner') || parsed.data.is_active === false);
  if (losingOwner) {
    const ownerCount = await db<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM admin_users
      WHERE role = 'owner' AND is_active = true AND organization_id = ${org}
    `;
    if (parseInt(ownerCount[0]?.count ?? '0', 10) <= 1) {
      res.status(400).json({ error: 'Cannot remove the last active owner' });
      return;
    }
  }

  const newRole = parsed.data.role ?? target[0].role;
  const newActive = parsed.data.is_active ?? target[0].is_active;
  await db`UPDATE admin_users SET role = ${newRole}, is_active = ${newActive} WHERE id = ${id}`;
  if (parsed.data.is_active === false) await deleteSessionsForUser(id);
  res.json({ ok: true });
});

// Revoke a pending invite.
adminRouter.delete('/invites/:id', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid invite id' });
    return;
  }
  await db`DELETE FROM admin_invites WHERE id = ${id} AND organization_id = ${req.adminUser!.organizationId}`;
  res.json({ deleted: true });
});

// A user's per-project grants.
adminRouter.get('/users/:id/projects', requireOwner, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }
  // Constrain to the caller's org on both the user and the joined projects so an owner
  // can't probe another tenant's grants.
  const org = req.adminUser!.organizationId;
  const memberships = await db`
    SELECT pm.project_id, p.name, pm.role
    FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ${id} AND p.organization_id = ${org}
    ORDER BY p.created_at DESC
  `;
  res.json({ memberships });
});

const MembershipSchema = z.object({ role: z.enum(['admin', 'viewer']) });

// Grant or update a member's access to a project.
adminRouter.put('/users/:id/projects/:projectId', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.id;
  const projectId = req.params.projectId;
  if (!userId || !UUID_RE.test(userId) || !projectId || !UUID_RE.test(projectId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const parsed = MembershipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  // Both the user and the project must live in the caller's org — you can only grant a
  // member of your tenant access to a project of your tenant.
  const org = req.adminUser!.organizationId;
  const user = await db`SELECT id FROM admin_users WHERE id = ${userId} AND organization_id = ${org} LIMIT 1`;
  if (!user[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const project = await db`SELECT id FROM projects WHERE id = ${projectId} AND organization_id = ${org} LIMIT 1`;
  if (!project[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await db`
    INSERT INTO project_members (user_id, project_id, role)
    VALUES (${userId}, ${projectId}, ${parsed.data.role})
    ON CONFLICT (user_id, project_id) DO UPDATE SET role = EXCLUDED.role
  `;
  res.json({ ok: true });
});

// Revoke a member's access to a project.
adminRouter.delete('/users/:id/projects/:projectId', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.id;
  const projectId = req.params.projectId;
  if (!userId || !UUID_RE.test(userId) || !projectId || !UUID_RE.test(projectId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  // Only touch grants on projects in the caller's org.
  await db`
    DELETE FROM project_members
    WHERE user_id = ${userId} AND project_id = ${projectId}
      AND project_id IN (SELECT id FROM projects WHERE organization_id = ${req.adminUser!.organizationId})
  `;
  res.json({ deleted: true });
});

// --- Two-factor auth (self-service) ------------------------------------------------

// Begin enrollment: mint a secret (stored encrypted, NOT yet enabled) and return the
// otpauth URI + secret for the authenticator app to scan / key in.
adminRouter.post('/me/2fa/setup', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  if (!isEncryptionConfigured()) {
    res.status(503).json({ error: 'Two-factor is unavailable: server encryption key (SCENT_SECRET_KEY) is not configured' });
    return;
  }
  const user = req.adminUser!;
  if (user.totpEnabled) {
    res.status(409).json({ error: 'Two-factor is already enabled' });
    return;
  }
  const secret = generateTotpSecret();
  await db`UPDATE admin_users SET totp_secret_enc = ${encrypt(secret)} WHERE id = ${user.id}`;
  res.json({ otpauthUri: totpKeyUri(user.email, secret), secret });
});

const TotpVerifySchema = z.object({ code: z.string().min(1) });

// Confirm enrollment: verify a code against the pending secret, flip 2FA on, and issue
// fresh one-time recovery codes (returned exactly once).
adminRouter.post('/me/2fa/verify', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const parsed = TotpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  const user = req.adminUser!;
  if (user.totpEnabled) {
    res.status(409).json({ error: 'Two-factor is already enabled' });
    return;
  }
  const rows = await db<{ totp_secret_enc: string | null }[]>`
    SELECT totp_secret_enc FROM admin_users WHERE id = ${user.id} LIMIT 1
  `;
  const enc = rows[0]?.totp_secret_enc;
  if (!enc || !isEncryptionConfigured()) {
    res.status(400).json({ error: 'Start two-factor setup first' });
    return;
  }
  let codeOk = false;
  try {
    codeOk = verifyTotp(parsed.data.code, decrypt(enc));
  } catch {
    codeOk = false;
  }
  if (!codeOk) {
    res.status(400).json({ error: 'Invalid code' });
    return;
  }

  const { codes, hashes } = generateRecoveryCodes();
  await db.begin(async (tx) => {
    await tx`UPDATE admin_users SET totp_enabled = true WHERE id = ${user.id}`;
    await tx`DELETE FROM admin_recovery_codes WHERE user_id = ${user.id}`;
    for (const h of hashes) {
      await tx`INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (${user.id}, ${h})`;
    }
  });
  res.json({ recoveryCodes: codes });
});

const DisableTotpSchema = z.object({ password: z.string().min(1) });

// Disable 2FA — requires a password re-auth, then clears the secret + recovery codes.
adminRouter.post('/me/2fa/disable', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const parsed = DisableTotpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  const user = req.adminUser!;
  const rows = await db<{ password_hash: string }[]>`SELECT password_hash FROM admin_users WHERE id = ${user.id} LIMIT 1`;
  const ok = rows[0] ? await verifyPassword(parsed.data.password, rows[0].password_hash) : false;
  if (!ok) {
    res.status(403).json({ error: 'Password is incorrect' });
    return;
  }
  await db.begin(async (tx) => {
    await tx`UPDATE admin_users SET totp_enabled = false, totp_secret_enc = NULL WHERE id = ${user.id}`;
    await tx`DELETE FROM admin_recovery_codes WHERE user_id = ${user.id}`;
  });
  res.json({ ok: true });
});

// --- Install settings (owner-only) -------------------------------------------------

adminRouter.get('/settings', requireOwner, async (req: Request, res: Response): Promise<void> => {
  res.json({ require_2fa: await isTwoFactorRequired(req.adminUser!.organizationId) });
});

const SettingsSchema = z.object({ require_2fa: z.boolean() });

adminRouter.put('/settings', requireCsrf, requireOwner, async (req: Request, res: Response): Promise<void> => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }
  // Turning the requirement on without an encryption key would let admins enroll but
  // not actually store secrets — refuse so the toggle can't create a broken state.
  if (parsed.data.require_2fa && !isEncryptionConfigured()) {
    res.status(400).json({ error: 'Cannot require two-factor: server encryption key (SCENT_SECRET_KEY) is not configured' });
    return;
  }
  await setTwoFactorRequired(req.adminUser!.organizationId, parsed.data.require_2fa);
  res.json({ require_2fa: parsed.data.require_2fa });
});
