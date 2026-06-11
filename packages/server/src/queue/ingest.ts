import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { SnapshotPayload } from '../schemas/events.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// The name shared by the producer (events route) and the consumer (worker).
export const INGEST_QUEUE_NAME = 'ingest';

// BullMQ requires a connection with maxRetriesPerRequest: null (a blocking client
// for its BRPOPLPUSH loop). This is a dedicated connection — distinct from the
// cached-key client in db/redis.ts, which uses maxRetriesPerRequest: 3.
export function createQueueConnection(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}

// One job per snapshot. clientIp is captured at the edge (the worker has no request
// context), and projectId is resolved by auth middleware before enqueue.
export interface IngestJobData {
  projectId: string;
  snap: SnapshotPayload;
  clientIp: string | null;
}

// Lazily-constructed producer-side queue. The connection opens on first enqueue
// (ioredis is lazy), so importing this in tests that never enqueue is free.
let queue: Queue<IngestJobData> | null = null;

export function getIngestQueue(): Queue<IngestJobData> {
  if (queue) return queue;
  queue = new Queue<IngestJobData>(INGEST_QUEUE_NAME, {
    connection: createQueueConnection(),
    defaultJobOptions: {
      // At-least-once: retry transient failures with backoff. The event_id dedupe
      // in resolveSnapshot makes a re-run of an already-committed job a no-op.
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return queue;
}
