// Imported first so Sentry.init runs before any instrumented module loads (same
// rationale as index.ts; redundant with `--import ./dist/instrument.js` in the image,
// covers the dev/tsx path). No-ops without SENTRY_DSN.
import './instrument.js';
import { startTracing } from './tracing.js';
startTracing();

import * as Sentry from '@sentry/node';
import { Queue, Worker } from 'bullmq';
import { createQueueConnection, INGEST_QUEUE_NAME } from './queue/ingest.js';
import type { IngestJobData } from './queue/ingest.js';
import { resolveSnapshot } from './pipeline/resolve.js';
import { sweepRetention, RETENTION_QUEUE_NAME } from './pipeline/retention.js';
import { db } from './db/client.js';
// Imported after ./tracing.js so the OTel pino instrumentation patches pino and
// injects trace_id/span_id into log lines — same ordering rationale as index.ts.
import { logger } from './logger.js';

// Background consumer for the ingest queue. Each job is one snapshot; the worker
// runs the full resolution pipeline (which the POST /v1/events route used to run
// synchronously). The scent.identity_resolution span is created inside
// resolveSnapshot, so worker spans land in Tempo just like the server's.
//
// Concurrency is bounded so a burst of ingest can't exhaust the Postgres pool
// (db/client.ts uses max: 10). Tune via WORKER_CONCURRENCY.
const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? 5);

const worker = new Worker<IngestJobData>(
  INGEST_QUEUE_NAME,
  async (job) => resolveSnapshot(db, job.data),
  { connection: createQueueConnection(), concurrency },
);

worker.on('ready', () => {
  logger.info({ queue: INGEST_QUEUE_NAME, concurrency }, 'scent-worker ready');
});

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, attemptsMade: job?.attemptsMade, err },
    'ingest job failed',
  );
  // BullMQ swallows the throw into this event, so the global handlers never see it —
  // capture explicitly. No-op without SENTRY_DSN.
  Sentry.captureException(err, {
    tags: { queue: INGEST_QUEUE_NAME },
    extra: { jobId: job?.id, attemptsMade: job?.attemptsMade },
  });
});

// Daily retention sweep (GDPR data-lifecycle, ADR-0004). A repeatable job is enqueued
// idempotently (BullMQ dedupes by repeat key, so re-adding on every boot is safe) and
// processed by a dedicated worker that deletes data past each project's retention_days.
const retentionQueue = new Queue(RETENTION_QUEUE_NAME, { connection: createQueueConnection() });
void retentionQueue
  .add('sweep', {}, { repeat: { pattern: '30 3 * * *' }, removeOnComplete: true, removeOnFail: 50 })
  .catch((err) => logger.error({ err }, 'failed to schedule retention sweep'));

const retentionWorker = new Worker(
  RETENTION_QUEUE_NAME,
  async () => sweepRetention(db),
  { connection: createQueueConnection() },
);
retentionWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'retention sweep failed');
  Sentry.captureException(err, {
    tags: { queue: RETENTION_QUEUE_NAME },
    extra: { jobId: job?.id },
  });
});

// Drain in-flight jobs and close the DB pool on shutdown so a redeploy doesn't drop
// work mid-resolution.
async function shutdown(): Promise<void> {
  logger.info('scent-worker shutting down');
  await worker.close();
  await retentionWorker.close();
  await retentionQueue.close();
  await db.end();
  // Flush any buffered events before exit (no-op without SENTRY_DSN). Bounded so a
  // Sentry outage can't stall a redeploy.
  await Sentry.flush(2000);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
