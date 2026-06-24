import { db } from '../db/client.js';
import { findOrCreateOrgByName } from '../lib/organizations.js';

// Set an organization's plan and soft monthly resolution limit. The thin/assisted
// onboarding path for Phase 7 metering: an operator activates a hosted customer's soft
// quota until the Observatory org-management UI lands. Enforcement is soft — exceeding
// the limit warns (logs + Sentry), it does not block.
//
//   tsx src/scripts/set-org-plan.ts "<orgName>" <plan> [limit|unlimited]   (dev)
//   docker compose exec scent-server node dist/scripts/set-org-plan.js "Acme" free 10000
//
// limit: an integer, or 'unlimited' (NULL) — the default when omitted. The org is
// created if it doesn't exist (idempotent), so this doubles as provisioning.
async function main(): Promise<void> {
  const orgName = process.argv[2]?.trim();
  const plan = process.argv[3]?.trim();
  const limitArg = process.argv[4]?.trim();

  if (!orgName || !plan) {
    console.error('Usage: set-org-plan "<orgName>" <plan> [limit|unlimited]');
    process.exit(1);
  }

  let limit: number | null = null;
  if (limitArg && limitArg !== 'unlimited') {
    limit = Number(limitArg);
    if (!Number.isInteger(limit) || limit < 0) {
      console.error(`Invalid limit "${limitArg}": expected a non-negative integer or 'unlimited'.`);
      process.exit(1);
    }
  }

  const organizationId = await findOrCreateOrgByName(orgName);
  await db`
    UPDATE organizations
    SET plan = ${plan}, monthly_resolution_limit = ${limit}
    WHERE id = ${organizationId}
  `;

  console.error(
    `Org "${orgName}" (${organizationId}) → plan=${plan}, monthly_resolution_limit=${limit ?? 'unlimited'}`,
  );

  await db.end();
}

main().catch((err: unknown) => {
  console.error('Failed to set org plan:', err);
  process.exit(1);
});
