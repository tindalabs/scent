import { migrate } from './migrate.js';
import { db } from './client.js';

migrate()
  .then(async () => {
    console.log('[migrate] all migrations applied');
    await db.end();
  })
  .catch((err: unknown) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
