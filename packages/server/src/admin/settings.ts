import { db } from '../db/client.js';

// Per-organization 2FA policy (migration 013). Each tenant decides whether its admins
// must enrol in 2FA, so one company tightening the requirement never affects another on
// the same box. Read fresh each call — a single indexed lookup on low-traffic admin
// paths, so caching isn't worth the invalidation risk when the toggle flips.
// (Supersedes the legacy install-wide admin_settings.require_2fa, kept only as the
// backfill seed for the Default org.)

export async function isTwoFactorRequired(organizationId: string): Promise<boolean> {
  const rows = await db<{ require_2fa: boolean }[]>`
    SELECT require_2fa FROM organizations WHERE id = ${organizationId} LIMIT 1
  `;
  return rows[0]?.require_2fa ?? false;
}

export async function setTwoFactorRequired(organizationId: string, value: boolean): Promise<void> {
  await db`UPDATE organizations SET require_2fa = ${value} WHERE id = ${organizationId}`;
}
