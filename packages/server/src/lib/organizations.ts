import { db } from '../db/client.js';

// Find an organization by name, or create it. Used by the bootstrap CLIs (create-admin,
// create-project) to attach the first admin/project to a tenant: a fresh self-host install
// has no org until the first bootstrap, so these scripts provision one. Multi-tenant hosts
// pass a distinct name per customer. Idempotent on name (re-running returns the same org).
export async function findOrCreateOrgByName(name: string): Promise<string> {
  const existing = await db<{ id: string }[]>`
    SELECT id FROM organizations WHERE name = ${name} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const [org] = await db<{ id: string }[]>`
    INSERT INTO organizations (name) VALUES (${name}) RETURNING id
  `;
  return org!.id;
}
