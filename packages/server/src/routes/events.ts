import { Router, type Request, type Response, type IRouter } from 'express';
import { EventsBatchSchema, deriveEventId } from '../schemas/events.js';
import { db } from '../db/client.js';
import {
  computeSimHash,
  simHashToHex,
  hexToSimHash,
  hammingDistance,
  weightedJaccard,
  scoreToConfidenceBand,
  scoreToIdentityContinuity,
  diffSnapshots,
  SIMHASH_CANDIDATE_THRESHOLD,
} from '@irregular/scent-engine';
import type { SignalMap, PersistencePolicy } from '@irregular/scent-engine';

export const eventsRouter: IRouter = Router();

eventsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = EventsBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
    return;
  }

  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }
  const projectId = project[0].id;

  const results: Array<{
    identityId: string;
    confidence: number;
    isNew: boolean;
    continuity: string;
  }> = [];

  for (const snap of parsed.data.snapshots) {
    const eventId = deriveEventId(snap.identityId, snap.timestamp);

    // Idempotent deduplication: if this exact event was already ingested, skip it.
    const existing = await db<{ id: string }[]>`
      SELECT id FROM snapshots WHERE event_id = ${eventId} LIMIT 1
    `;
    if (existing[0]) {
      results.push({
        identityId: snap.identityId,
        confidence: 1,
        isNew: false,
        continuity: 'confirmed',
      });
      continue;
    }

    const signals = snap.signals as SignalMap;
    const simHash = computeSimHash(signals);
    const signalHash = simHashToHex(simHash);

    // Look for existing identities in this project that might be the same entity.
    // Candidate retrieval: pull all snapshots and compare SimHash Hamming distance.
    // Phase 2 uses a full scan with in-process filtering; Phase 3 can add a
    // proper BK-tree index when identity counts make this prohibitive.
    const candidates = await db<{ identity_id: string; signal_hash: string; timestamp: Date; signals: SignalMap }[]>`
      SELECT DISTINCT ON (s.identity_id)
        s.identity_id,
        s.signal_hash,
        s.timestamp,
        s.signals
      FROM snapshots s
      WHERE s.project_id = ${projectId}
      ORDER BY s.identity_id, s.timestamp DESC
    `;

    let bestIdentityId: string | null = null;
    let bestConfidence = 0;

    for (const candidate of candidates) {
      const candidateHash = hexToSimHash(candidate.signal_hash);
      const hamming = hammingDistance(simHash, candidateHash);
      if (hamming > SIMHASH_CANDIDATE_THRESHOLD) continue;

      const daysSince =
        (new Date(snap.timestamp).getTime() - new Date(candidate.timestamp).getTime()) /
        (1000 * 60 * 60 * 24);

      const { confidence } = weightedJaccard(signals, candidate.signals, daysSince);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestIdentityId = candidate.identity_id;
      }
    }

    // Threshold: below 0.35 we treat this as a new identity.
    const isNew = bestIdentityId === null || bestConfidence < 0.35;
    const resolvedId = isNew ? snap.identityId : bestIdentityId!;
    const continuity = scoreToIdentityContinuity(isNew ? 0 : bestConfidence);
    const confidenceBand = scoreToConfidenceBand(isNew ? 0 : bestConfidence);

    await db.begin(async (tx) => {
      if (isNew) {
        await tx`
          INSERT INTO identities (id, project_id, confidence_band, risk_band)
          VALUES (${resolvedId}, ${projectId}, ${confidenceBand}, 'low')
          ON CONFLICT (id) DO NOTHING
        `;
      } else {
        await tx`
          UPDATE identities
          SET last_seen = now(),
              snapshot_count = snapshot_count + 1,
              confidence_band = ${confidenceBand}
          WHERE id = ${resolvedId}
        `;
      }

      const [newSnap] = await tx<{ id: string }[]>`
        INSERT INTO snapshots
          (identity_id, project_id, event_id, timestamp, signals, signal_hash, persistence_policy, traceparent)
        VALUES
          (${resolvedId}, ${projectId}, ${eventId}, ${snap.timestamp},
           ${tx.json(signals)}, ${signalHash},
           ${snap.persistencePolicy as PersistencePolicy},
           ${snap.traceparent ?? null})
        RETURNING id
      `;

      // Compute and store drift if this is a returning identity.
      if (!isNew && newSnap) {
        const prevSnap = await tx<{ id: string; signals: SignalMap }[]>`
          SELECT id, signals FROM snapshots
          WHERE identity_id = ${resolvedId} AND id != ${newSnap.id}
          ORDER BY timestamp DESC
          LIMIT 1
        `;
        if (prevSnap[0]) {
          const drift = diffSnapshots(prevSnap[0].signals, signals);
          await tx`
            INSERT INTO drifts
              (identity_id, before_snapshot_id, after_snapshot_id, classification, entropy, changed_signals, added_signals, removed_signals)
            VALUES
              (${resolvedId}, ${prevSnap[0].id}, ${newSnap.id},
               ${drift.classification}, ${drift.entropy},
               ${drift.changedSignals}, ${drift.addedSignals}, ${drift.removedSignals})
          `;
        }
      }
    });

    results.push({
      identityId: resolvedId,
      confidence: isNew ? 0 : bestConfidence,
      isNew,
      continuity,
    });
  }

  res.json({ results });
});
