import type { Request, Response, NextFunction } from 'express';
import { validateSession, SESSION_COOKIE, type AdminUser } from './session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

// Gate /admin/* (except login) on a valid admin session cookie. Distinct from
// requireApiKey, which gates the project data API (/v1/*).
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = await validateSession(token);
  if (!user) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.adminUser = user;
  next();
}
