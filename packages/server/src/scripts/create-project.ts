import { db } from '../db/client.js';
import { mintApiKey } from '../lib/api-key.js';

// Create a project and mint its API key. Only the key's hash is stored; the
// plaintext is printed once here and cannot be recovered later.
//
//   tsx src/scripts/create-project.ts "Project Name"          (dev)
//   node dist/scripts/create-project.js "Project Name"        (in the image)
//   docker compose exec scent-server node dist/scripts/create-project.js "Prod"
async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: create-project "<project name>"');
    process.exit(1);
  }

  const { apiKey, keyHash, keyPrefix } = mintApiKey();

  const [project] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name, key_prefix)
    VALUES (${keyHash}, ${name}, ${keyPrefix})
    RETURNING id
  `;

  // The key is shown exactly once. Print to stdout; everything else to stderr so
  // `... | tail` style capture of just the key works.
  console.error(`Created project "${name}" (id: ${project?.id})`);
  console.error('API key (store it now — it is not recoverable):');
  console.log(apiKey);

  await db.end();
}

main().catch((err: unknown) => {
  console.error('Failed to create project:', err);
  process.exit(1);
});
