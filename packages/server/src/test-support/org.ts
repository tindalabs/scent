import { db } from '../db/client.js';

// Test helper: create an organization and return its id. Multi-tenant tests assign their
// admins and projects to an org so the org-scoped admin queries (migration 013) resolve.
// Pair with deleteTestOrg in afterAll (delete dependent rows first — the FK is RESTRICT).
export async function createTestOrg(name: string, requireTwoFactor = false): Promise<string> {
  const [org] = await db<{ id: string }[]>`
    INSERT INTO organizations (name, require_2fa) VALUES (${name}, ${requireTwoFactor}) RETURNING id
  `;
  return org!.id;
}

export async function deleteTestOrg(name: string): Promise<void> {
  await db`DELETE FROM organizations WHERE name = ${name}`;
}
