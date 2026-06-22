// Imported first so Sentry.init runs before any instrumented module loads. In the
// built image this is redundant with `--import ./dist/instrument.js` (Dockerfile CMD);
// here it covers the dev/tsx path. No-ops without SENTRY_DSN.
import './instrument.js';
import { startTracing } from './tracing.js';
startTracing();

import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
// Imported after ./tracing.js so the OTel pino instrumentation (registered during
// startTracing) patches pino and injects trace_id/span_id into log lines.
import { logger } from './logger.js';

const app = createApp();
const port = process.env['PORT'] ?? 3000;

migrate()
  .then(() => {
    app.listen(port, () => {
      logger.info({ port }, 'scent-server listening');
    });
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'migration failed on startup; exiting');
    process.exit(1);
  });
