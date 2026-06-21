import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db/client.js';
import type { AdminRole } from './session.js';

// Invite-based provisioning (no SMTP): an owner mints an invite, the raw token travels
// in a copy-paste link, and only its SHA-256 is stored. Single-use and time-boxed.
const INVITE_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Invite {
  id: string;
  email: string;
  role: AdminRole;
  expires_at: string;
}

// Create an invite scoped to the inviter's organization; returns the raw token (shown
// once) plus the stored row. The org travels with the invite so the accepted account
// lands in the inviting company.
export async function createInvite(
  email: string,
  role: AdminRole,
  invitedBy: string,
  organizationId: string,
): Promise<{ token: string; invite: Invite }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [invite] = await db<Invite[]>`
    INSERT INTO admin_invites (email, token_hash, role, invited_by, organization_id, expires_at)
    VALUES (${email}, ${hashToken(token)}, ${role}, ${invitedBy}, ${organizationId}, ${expiresAt.toISOString()})
    RETURNING id, email, role, expires_at
  `;
  return { token, invite: invite! };
}

// Resolve a raw token to a pending, unexpired invite, or null.
export async function findValidInvite(
  token: string,
): Promise<{ id: string; email: string; role: AdminRole; organization_id: string } | null> {
  const rows = await db<{ id: string; email: string; role: AdminRole; organization_id: string }[]>`
    SELECT id, email, role, organization_id
    FROM admin_invites
    WHERE token_hash = ${hashToken(token)}
      AND accepted_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function markInviteAccepted(id: string): Promise<void> {
  await db`UPDATE admin_invites SET accepted_at = now() WHERE id = ${id}`;
}
