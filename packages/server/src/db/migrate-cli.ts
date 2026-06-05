import { migrate } from './migrate.js';
import { db } from './client.js';
import { logger } from '../logger.js';

migrate()
  .then(async () => {
    logger.info('all migrations applied');
    await db.end();
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'migration run failed');
    process.exit(1);
  });
