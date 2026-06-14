import { Router, type Request, type Response, type IRouter } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { mintApiKey } from '../lib/api-key.js';
import { verifyPassword } from '../admin/password.js';
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from '../admin/session.js';
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
  const rows = await db<{ id: string; password_hash: string; role: string }[]>`
    SELECT id, password_hash, role FROM admin_users WHERE email = ${email} LIMIT 1
  `;

  // Generic failure for both unknown-email and wrong-password (no enumeration).
  const user = rows[0];
  const ok = user ? await verifyPassword(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = await createSession(user.id);
  await db`UPDATE admin_users SET last_login_at = now() WHERE id = ${user.id}`;
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  issueCsrfToken(res); // double-submit token for subsequent mutations
  res.json({ email, role: user.role });
});

adminRouter.post('/logout', requireCsrf, async (req: Request, res: Response): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  clearCsrfToken(res);
  res.json({ ok: true });
});

// Everything below requires a valid admin session. Mutating routes additionally
// require the CSRF token (GETs don't need it).
adminRouter.use(requireAdmin);

adminRouter.get('/me', (req: Request, res: Response): void => {
  res.json({ email: req.adminUser?.email, role: req.adminUser?.role });
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
