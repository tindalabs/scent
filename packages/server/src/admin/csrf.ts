import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const CSRF_COOKIE = 'scent_csrf';
const CSRF_HEADER = 'x-csrf-token';

const isProd = process.env['NODE_ENV'] === 'production';

// Double-submit-cookie CSRF defense for the cookie-authenticated admin API. A random
// token is set in a JS-readable cookie at login; the SPA echoes it in the
// X-CSRF-Token header on every state-changing request. A cross-site attacker can
// neither read the cookie (blocked by the same-origin policy) nor set a custom
// header, so forged requests are rejected. Layered on top of the SameSite=Lax
// session cookie. Only applied to mutating routes — GETs and login don't need it.
export function issueCsrfToken(res: Response): void {
  const token = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // the SPA must read it to echo it back
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  });
}

export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE, { sameSite: 'lax', secure: isProd, path: '/' });
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || cookie !== header) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next();
}
