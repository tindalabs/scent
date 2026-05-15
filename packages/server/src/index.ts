import express from 'express';
import { migrate } from './db/migrate.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { eventsRouter } from './routes/events.js';
import { identityRouter } from './routes/identity.js';
import { identitiesRouter } from './routes/identities.js';
import { resolveRouter } from './routes/resolve.js';
import { dashboardRouter } from './routes/dashboard.js';
import { clustersRouter } from './routes/clusters.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', phase: 4 });
});

// All /v1/* routes require a valid X-Api-Key and are rate-limited per key.
app.use('/v1', rateLimitMiddleware);
app.use('/v1/events', eventsRouter);
app.use('/v1/identity', identityRouter);
app.use('/v1/identities', identitiesRouter);
app.use('/v1/resolve', resolveRouter);
app.use('/v1/dashboard', dashboardRouter);
app.use('/v1/clusters', clustersRouter);

const port = process.env['PORT'] ?? 3000;

migrate()
  .then(() => {
    app.listen(port, () => {
      console.log(`scent-server listening on :${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
