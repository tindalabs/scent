import { Router, type Request, type Response, type IRouter } from 'express';
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

export const adminRouter: IRouter = Router();

const isProd = process.env['NODE_ENV'] === 'production';

// HttpOnly so JS can't read it; SameSite=Lax blocks cross-site POST (CSRF) while
// allowing same-site navigation; Secure in production (HTTPS).
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  maxAge: SESSION_MAX_AGE_MS,
  path: '/',
};

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
});

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
  const rows = await db<{ id: string; password_hash: string; role: string; is_active: boolean }[]>`
    SELECT id, password_hash, role, is_active FROM admin_users WHERE email = ${email} LIMIT 1
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

  const token = await createSession(user.id);
  await db`UPDATE admin_users SET last_login_at = now() WHERE id = ${user.id}`;
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  issueCsrfToken(res); // double-submit token for subsequent mutations
  res.json({ id: user.id, email, role: user.role });
});

adminRouter.post('/logout', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  clearCsrfToken(res);
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
    INSERT INTO admin_users (email, password_hash, role, is_active)
    VALUES (${invite.email}, ${passwordHash}, ${invite.role}, true)
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;
  if (!user) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  await markInviteAccepted(invite.id);

  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  issueCsrfToken(res);
  res.status(201).json({ id: user.id, email: invite.email, role: invite.role });
});

// Everything below requires a valid admin session. Mutating routes additionally
// require the CSRF token (GETs don't need it).
adminRouter.use(requireAdmin);

adminRouter.get('/me', (req: Request, res: Response): void => {
  res.json({ id: req.adminUser?.id, email: req.adminUser?.email, role: req.adminUser?.role });
});

adminRouter.get('/projects', async (req: Request, res: Response): Promise<void> => {
  const user = req.adminUser!;
  // Owners see every project (with the synthetic role 'owner'); members see only the
  // projects granted to them in project_members, tagged with their per-project role.
  const projects = user.role === 'owner'
    ? await db`
        SELECT id, name, key_prefix, created_at, 'owner' AS role
        FROM projects
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
    INSERT INTO projects (api_key_hash, name, key_prefix)
    VALUES (${keyHash}, ${parsed.data.name}, ${keyPrefix})
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
  const existing = await db<{ api_key_hash: string }[]>`
    SELECT api_key_hash FROM projects WHERE id = ${id} LIMIT 1
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
    SELECT api_key_hash FROM projects WHERE id = ${id} LIMIT 1
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
adminRouter.get('/users', requireOwner, async (_req: Request, res: Response): Promise<void> => {
  const users = await db`
    SELECT id, email, role, is_active, last_login_at, created_at
    FROM admin_users ORDER BY created_at ASC
  `;
  const invites = await db`
    SELECT id, email, role, expires_at, created_at
    FROM admin_invites WHERE accepted_at IS NULL AND expires_at > now()
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
  const { token, invite } = await createInvite(email, parsed.data.role, req.adminUser!.id);
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
  const target = await db<{ id: string; role: string; is_active: boolean }[]>`
    SELECT id, role, is_active FROM admin_users WHERE id = ${id} LIMIT 1
  `;
  if (!target[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Don't strip the install of its last active owner (demote or deactivate).
  const losingOwner =
    target[0].role === 'owner' &&
    ((parsed.data.role !== undefined && parsed.data.role !== 'owner') || parsed.data.is_active === false);
  if (losingOwner) {
    const ownerCount = await db<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM admin_users WHERE role = 'owner' AND is_active = true
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
  await db`DELETE FROM admin_invites WHERE id = ${id}`;
  res.json({ deleted: true });
});

// A user's per-project grants.
adminRouter.get('/users/:id/projects', requireOwner, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }
  const memberships = await db`
    SELECT pm.project_id, p.name, pm.role
    FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ${id}
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
  const user = await db`SELECT id FROM admin_users WHERE id = ${userId} LIMIT 1`;
  if (!user[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const project = await db`SELECT id FROM projects WHERE id = ${projectId} LIMIT 1`;
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
  await db`DELETE FROM project_members WHERE user_id = ${userId} AND project_id = ${projectId}`;
  res.json({ deleted: true });
});
