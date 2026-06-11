import { startTracing } from './tracing.js';
startTracing();

import { Worker } from 'bullmq';
import { createQueueConnection, INGEST_QUEUE_NAME } from './queue/ingest.js';
import type { IngestJobData } from './queue/ingest.js';
import { resolveSnapshot } from './pipeline/resolve.js';
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
});

// Drain in-flight jobs and close the DB pool on shutdown so a redeploy doesn't drop
// work mid-resolution.
async function shutdown(): Promise<void> {
  logger.info('scent-worker shutting down');
  await worker.close();
  await db.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
