import { Router, type Request, type Response, type IRouter } from 'express';
import { EventsBatchSchema } from '../schemas/events.js';
import { getIngestQueue, INGEST_QUEUE_NAME } from '../queue/ingest.js';

export const eventsRouter: IRouter = Router();

// POST /v1/events — accept a batch of snapshots and enqueue one resolution job per
// snapshot, returning 202 immediately. The full resolution pipeline (matching,
// identity tx, drift, cluster linking, risk, webhooks) runs in the background worker
// (see src/worker.ts → pipeline/resolve.ts).
//
// This intentionally no longer returns per-snapshot confidence/risk. That is safe:
// the SDK's flush() fires-and-forgets — it awaits the fetch but never reads the body
// (packages/sdk/src/index.ts). Callers needing an inline answer use POST /v1/resolve,
// which stays synchronous.
eventsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = EventsBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
    return;
  }

  const projectId = req.projectId;

  // Capture the client IP server-side at the edge. Trust X-Forwarded-For only when
  // behind a known proxy; req.ip respects Express's trust proxy setting. The worker
  // has no request context, so this is threaded into each job.
  const clientIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.ip
    ?? null;

  const queue = getIngestQueue();
  await queue.addBulk(
    parsed.data.snapshots.map((snap) => ({
      name: INGEST_QUEUE_NAME,
      data: { projectId, snap, clientIp },
    })),
  );

  res.status(202).json({ accepted: parsed.data.snapshots.length });
});
