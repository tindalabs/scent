import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import type { AdminUser } from './session.js';

// Authorization helpers for the two-level admin RBAC (see migration 009):
//   - owners are superusers: implicit access to every project, and the only role that
//     can create/delete projects and (PR2) manage admin accounts.
//   - members reach only the projects granted in project_members; their per-project
//     role decides manage ('admin') vs read-only ('viewer').

export function isOwner(user: AdminUser): boolean {
  return user.role === 'owner';
}

// Can the user READ this project's data? Owner, or any membership row.
export async function canViewProject(user: AdminUser, projectId: string): Promise<boolean> {
  if (isOwner(user)) return true;
  const rows = await db<{ id: string }[]>`
    SELECT id FROM project_members
    WHERE user_id = ${user.id} AND project_id = ${projectId}
    LIMIT 1
  `;
  return rows.length > 0;
}

// Can the user MANAGE this project (rotate keys etc.)? Owner, or a project 'admin'.
export async function canManageProject(user: AdminUser, projectId: string): Promise<boolean> {
  if (isOwner(user)) return true;
  const rows = await db<{ id: string }[]>`
    SELECT id FROM project_members
    WHERE user_id = ${user.id} AND project_id = ${projectId} AND role = 'admin'
    LIMIT 1
  `;
  return rows.length > 0;
}

// Gate a route on the owner role. Assumes requireAdmin has already run (req.adminUser set).
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.adminUser || !isOwner(req.adminUser)) {
    res.status(403).json({ error: 'Owner role required' });
    return;
  }
  next();
}
