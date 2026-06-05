import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './client.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename  TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = await db<{ filename: string }[]>`
    SELECT filename FROM _migrations ORDER BY filename
  `;
  const appliedSet = new Set(applied.map((r) => r.filename));

  // Read migration files in lexicographic order so numbering controls sequence.
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`INSERT INTO _migrations (filename) VALUES (${file})`;
    });
    logger.info({ file }, 'migration applied');
  }
}
