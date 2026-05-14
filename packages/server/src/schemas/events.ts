import { z } from 'zod';

const SignalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const SnapshotSchema = z.object({
  identityId: z.string().uuid(),
  signals: z.record(z.string(), SignalValueSchema),
  persistencePolicy: z.enum(['conservative', 'balanced', 'aggressive', 'forensic']),
  timestamp: z.string().datetime(),
  traceparent: z.string().optional(),
});

// The SDK's flush() wraps snapshots in a { snapshots: [...] } envelope.
// Each element in the array is one sdk.observe() call.
export const EventsBatchSchema = z.object({
  snapshots: z.array(SnapshotSchema).min(1).max(100),
});

// eventId is the identityId+timestamp composite used for idempotent deduplication.
// We derive it server-side so the SDK doesn't need to generate a separate UUID.
export function deriveEventId(identityId: string, timestamp: string): string {
  return `${identityId}:${timestamp}`;
}

export type SnapshotPayload = z.infer<typeof SnapshotSchema>;
export type EventsBatch = z.infer<typeof EventsBatchSchema>;
