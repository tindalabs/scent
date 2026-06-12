import { randomBytes } from 'node:crypto';
import { db } from '../db/client.js';
import { hashApiKey } from '../middleware/api-key.js';

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

  // 32 random bytes -> 64 hex chars. High entropy, so the stored SHA-256 needs no salt.
  const apiKey = randomBytes(32).toString('hex');

  const [project] = await db<{ id: string }[]>`
    INSERT INTO projects (api_key_hash, name)
    VALUES (${hashApiKey(apiKey)}, ${name})
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
