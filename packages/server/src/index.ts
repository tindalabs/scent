import { startTracing } from './tracing.js';
startTracing();

import express from 'express';
import cors from 'cors';
import { migrate } from './db/migrate.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { eventsRouter } from './routes/events.js';
import { identityRouter } from './routes/identity.js';
import { identitiesRouter } from './routes/identities.js';
import { resolveRouter } from './routes/resolve.js';
import { dashboardRouter } from './routes/dashboard.js';
import { clustersRouter } from './routes/clusters.js';
import { accountRouter } from './routes/account.js';

const ALLOWED_ORIGINS = [
  'http://localhost:4000',  // Observatory (docker-compose)
  'http://localhost:5173',  // Vite dev (demo app)
  'http://localhost:5174',  // Vite dev (alternate port)
  'http://localhost:4173',  // Vite preview
  'http://localhost:4174',  // Vite preview (alternate port)
  'http://localhost:3002',  // tindalabs-dev Next.js (falls back from 3000)
  'http://localhost:3003',  // tindalabs-dev alternate
];

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server) and whitelisted origins.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  // Explicit allowedHeaders so browsers include traceparent/tracestate in cross-origin
  // requests. Without this the W3C TraceContext headers are stripped in preflight,
  // breaking browser→server trace correlation.
  allowedHeaders: ['Content-Type', 'x-api-key', 'traceparent', 'tracestate', 'baggage'],
}));
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
app.use('/v1/account', accountRouter);

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
