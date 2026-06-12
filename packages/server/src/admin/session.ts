import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db/client.js';

// Server-side, revocable sessions. The cookie carries a random opaque token; only
// its SHA-256 is stored, so the admin_sessions table can't be replayed if leaked.
const SESSION_TTL_DAYS = 7;
export const SESSION_COOKIE = 'scent_admin';

export interface AdminUser {
  id: string;
  email: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Create a session for a user; returns the raw token to set in the cookie.
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db`
    INSERT INTO admin_sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, ${expiresAt.toISOString()})
  `;
  return token;
}

// Resolve a raw token to its admin user, or null if missing/expired.
export async function validateSession(token: string): Promise<AdminUser | null> {
  const rows = await db<{ id: string; email: string }[]>`
    SELECT u.id, u.email
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// Revoke a single session (logout).
export async function deleteSession(token: string): Promise<void> {
  await db`DELETE FROM admin_sessions WHERE token_hash = ${hashToken(token)}`;
}

export const SESSION_MAX_AGE_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
