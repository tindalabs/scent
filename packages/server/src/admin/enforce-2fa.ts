import type { Request, Response, NextFunction } from 'express';
import { isTwoFactorRequired } from './settings.js';

// When the install requires 2FA, an authenticated-but-not-yet-enrolled admin is
// funneled into enrollment: every admin route is blocked with a recognizable error
// EXCEPT the ones they need to enroll or manage their own session. Login still issues a
// session for these users (so they CAN enroll) — this middleware is what stops them
// doing anything else until they do. Runs after requireAdmin (req.adminUser is set).
//
// Paths are relative to the /admin mount (Express strips the mount from req.path).
function isExempt(path: string): boolean {
  return path === '/me' || path === '/logout' || path === '/me/password' || path.startsWith('/me/2fa');
}

export async function enforce2faEnrollment(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.adminUser;
  if (!user || user.totpEnabled || isExempt(req.path)) {
    next();
    return;
  }
  if (await isTwoFactorRequired(user.organizationId)) {
    res.status(403).json({ error: 'two_factor_enrollment_required' });
    return;
  }
  next();
}
