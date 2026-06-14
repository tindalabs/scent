import { db } from '../db/client.js';
import { hashPassword } from '../admin/password.js';

// Bootstrap an admin user. This is the install owner: CLI-created admins are always
// 'owner' (full access — manages projects and, going forward, other admins). Member
// accounts are provisioned from the Observatory, not here. Password is hashed with
// bcrypt before it touches the DB.
//
//   tsx src/scripts/create-admin.ts <email> <password>          (dev)
//   docker compose exec scent-server node dist/scripts/create-admin.js <email> <pw>
//
// Re-running for an existing email resets the password but leaves the role untouched.
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: create-admin <email> <password>');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db<{ id: string }[]>`
    INSERT INTO admin_users (email, password_hash, role)
    VALUES (${email}, ${passwordHash}, 'owner')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id
  `;

  console.error(`Admin user ready: ${email} (id: ${user?.id})`);
  await db.end();
}

main().catch((err: unknown) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
