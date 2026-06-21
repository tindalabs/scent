import { db } from '../db/client.js';
import { mintApiKey } from '../lib/api-key.js';
import { findOrCreateOrgByName } from '../lib/organizations.js';

// Create a project and mint its API key. Only the key's hash is stored; the
// plaintext is printed once here and cannot be recovered later.
//
//   tsx src/scripts/create-project.ts "Project Name" [orgName]   (dev)
//   node dist/scripts/create-project.js "Project Name" [org]     (in the image)
//   docker compose exec scent-server node dist/scripts/create-project.js "Prod"
//
// The optional org name (default 'Default') attaches the project to a tenant, creating
// it if needed — every project belongs to an organization (migration 013).
async function main(): Promise<void> {
  const name = process.argv[2];
  const orgName = process.argv[3]?.trim() || 'Default';
  if (!name) {
    console.error('Usage: create-project "<project name>" [orgName]');
    process.exit(1);
  }

  const { apiKey, keyHash, keyPrefix } = mintApiKey();
  const organizationId = await findOrCreateOrgByName(orgName);

  const [project] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, key_prefix, organization_id)
    VALUES (${keyHash}, ${name}, ${keyPrefix}, ${organizationId})
    RETURNING id
  `;

  // The key is shown exactly once. Print to stdout; everything else to stderr so
  // `... | tail` style capture of just the key works.
  console.error(`Created project "${name}" (id: ${project?.id}, org: ${orgName})`);
  console.error('API key (store it now — it is not recoverable):');
  console.log(apiKey);

  await db.end();
}

main().catch((err: unknown) => {
  console.error('Failed to create project:', err);
  process.exit(1);
});
