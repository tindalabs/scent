import { db } from '../db/client.js';

// Install-wide admin settings (single row, see migration 011). Read fresh each call —
// it's one indexed single-row lookup on low-traffic admin paths, so caching isn't
// worth the invalidation risk when the toggle flips.

export async function isTwoFactorRequired(): Promise<boolean> {
  const rows = await db<{ require_2fa: boolean }[]>`SELECT require_2fa FROM admin_settings WHERE id = true LIMIT 1`;
  return rows[0]?.require_2fa ?? false;
}

export async function setTwoFactorRequired(value: boolean): Promise<void> {
  await db`UPDATE admin_settings SET require_2fa = ${value} WHERE id = true`;
}
