import { db } from '../db/client.js';
import { hashPassword } from '../admin/password.js';
import { findOrCreateOrgByName } from '../lib/organizations.js';

// Bootstrap an admin user. This is the install owner: CLI-created admins are always
// 'owner' (full access — manages projects and other admins WITHIN their org). Member
// accounts are provisioned from the Observatory, not here. Password is hashed with
// bcrypt before it touches the DB.
//
//   tsx src/scripts/create-admin.ts <email> <password> [orgName]   (dev)
//   docker compose exec scent-server node dist/scripts/create-admin.js <email> <pw> [org]
//
// The optional org name (default 'Default') attaches the admin to a tenant, creating it
// if needed — this is how a fresh install gets its first org + owner, and how an operator
// adds a second tenant on a hosted box. Re-running for an existing email resets the
// password but leaves the role and org untouched.
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  const orgName = process.argv[4]?.trim() || 'Default';
  if (!email || !password) {
    console.error('Usage: create-admin <email> <password> [orgName]');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const organizationId = await findOrCreateOrgByName(orgName);
  const [user] = await db<{ id: string }[]>`
    INSERT INTO admin_users (email, password_hash, role, organization_id)
    VALUES (${email}, ${passwordHash}, 'owner', ${organizationId})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  console.error(`Admin user ready: ${email} (id: ${user?.id}, org: ${orgName})`);
  await db.end();
}

main().catch((err: unknown) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
