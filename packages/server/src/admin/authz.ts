import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import type { AdminUser } from './session.js';

// Authorization helpers for the two-level admin RBAC (migration 009), now scoped to the
// organization tenant layer (migration 013):
//   - owners are superusers WITHIN THEIR OWN ORG: implicit access to every project in
//     their org, and the only role that can create/delete projects and manage admins —
//     but never anything in another org.
//   - members reach only the projects granted in project_members (always same-org); their
//     per-project role decides manage ('admin') vs read-only ('viewer').

export function isOwner(user: AdminUser): boolean {
  return user.role === 'owner';
}

// Does this project belong to the user's org? The gate for owner access — an owner is a
// superuser only inside their own tenant.
async function projectInOrg(projectId: string, organizationId: string): Promise<boolean> {
  const rows = await db<{ id: string }[]>`
    SELECT id FROM projects
    WHERE id = ${projectId} AND organization_id = ${organizationId}
    LIMIT 1
  `;
  return rows.length > 0;
}

// Can the user READ this project's data? An owner of the project's org, or any membership
// row (memberships are same-org by construction).
export async function canViewProject(user: AdminUser, projectId: string): Promise<boolean> {
  if (isOwner(user)) return projectInOrg(projectId, user.organizationId);
  const rows = await db<{ id: string }[]>`
    SELECT id FROM project_members
    WHERE user_id = ${user.id} AND project_id = ${projectId}
    LIMIT 1
  `;
  return rows.length > 0;
}

// Can the user MANAGE this project (rotate keys etc.)? An owner of the project's org, or a
// project 'admin'.
export async function canManageProject(user: AdminUser, projectId: string): Promise<boolean> {
  if (isOwner(user)) return projectInOrg(projectId, user.organizationId);
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
