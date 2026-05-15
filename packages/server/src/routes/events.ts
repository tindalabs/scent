import { Router, type Request, type Response, type IRouter } from 'express';
import type { TransactionSql } from 'postgres';
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
import { absenceWeightOverrides, updateSignalProfile } from '../engine/signal-profile.js';
import type { SignalProfile } from '../engine/signal-profile.js';
import { assessRisk } from '../risk/assess.js';
import { deliverWebhooks } from '../risk/webhook.js';

export const eventsRouter: IRouter = Router();

// Confidence threshold above which a second candidate is considered an
// ambiguous match (one snapshot plausibly matching two stored identities).
const AMBIGUOUS_MATCH_THRESHOLD = 0.60;

// Confidence above which two distinct stored identities are considered the
// same real-world entity and should be linked into a cluster.
const CLUSTER_LINK_THRESHOLD = 0.90;

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

  // Capture the client IP server-side. Trust X-Forwarded-For only when behind
  // a known proxy; for Phase 3 we use Express's req.ip which respects trust proxy.
  const clientIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.ip
    ?? null;

  const results: Array<{
    identityId: string;
    confidence: number;
    isNew: boolean;
    continuity: string;
    risk: { score: number; band: string; flags: string[] };
    ambiguous?: boolean;
  }> = [];

  for (const snap of parsed.data.snapshots) {
    const eventId = deriveEventId(snap.identityId, snap.timestamp);

    // Idempotent deduplication: identical event_id is a no-op.
    const existing = await db<{ id: string }[]>`
      SELECT id FROM snapshots WHERE event_id = ${eventId} LIMIT 1
    `;
    if (existing[0]) {
      results.push({ identityId: snap.identityId, confidence: 1, isNew: false, continuity: 'confirmed', risk: { score: 0, band: 'low', flags: [] } });
      continue;
    }

    const signals = snap.signals as SignalMap;
    const simHash = computeSimHash(signals);
    const signalHash = simHashToHex(simHash);

    // Fetch the most-recent snapshot per identity in this project for candidate matching.
    const candidates = await db<{
      identity_id: string;
      signal_hash: string;
      timestamp: Date;
      signals: SignalMap;
      signal_profile: SignalProfile;
    }[]>`
      SELECT DISTINCT ON (s.identity_id)
        s.identity_id,
        s.signal_hash,
        s.timestamp,
        s.signals,
        i.signal_profile
      FROM snapshots s
      JOIN identities i ON i.id = s.identity_id
      WHERE s.project_id = ${projectId}
      ORDER BY s.identity_id, s.timestamp DESC
    `;

    // Score every candidate that passes the SimHash Hamming pre-filter.
    const scored: Array<{ identityId: string; confidence: number }> = [];

    for (const candidate of candidates) {
      const candidateHash = hexToSimHash(candidate.signal_hash);
      if (hammingDistance(simHash, candidateHash) > SIMHASH_CANDIDATE_THRESHOLD) continue;

      const daysSince =
        (new Date(snap.timestamp).getTime() - new Date(candidate.timestamp).getTime()) /
        (1000 * 60 * 60 * 24);

      const weightOverrides = absenceWeightOverrides(candidate.signal_profile);

      const { confidence } = weightedJaccard(signals, candidate.signals, {
        daysSinceLastObservation: daysSince,
        weightOverrides,
      });

      scored.push({ identityId: candidate.identity_id, confidence });
    }

    // Sort descending by confidence.
    scored.sort((a, b) => b.confidence - a.confidence);

    const best = scored[0];
    const secondBest = scored[1];

    const isNew = !best || best.confidence < 0.35;
    const resolvedId = isNew ? snap.identityId : best.identityId;
    const finalConfidence = isNew ? 0 : best.confidence;

    // Flag ambiguous matches: two candidates both above the ambiguity threshold.
    const ambiguous =
      !isNew &&
      secondBest !== undefined &&
      secondBest.confidence >= AMBIGUOUS_MATCH_THRESHOLD;

    const continuity = scoreToIdentityContinuity(finalConfidence);
    const confidenceBand = scoreToConfidenceBand(finalConfidence);

    // Look up the stored signal_profile for the resolved identity (may be new).
    const storedProfile = isNew
      ? {}
      : ((
          await db<{ signal_profile: SignalProfile }[]>`
            SELECT signal_profile FROM identities WHERE id = ${resolvedId} LIMIT 1
          `
        )[0]?.signal_profile ?? {});

    const updatedProfile = updateSignalProfile(storedProfile, signals, snap.timestamp);

    // newSnapId is set inside the transaction and read outside to run risk assessment.
    let newSnapId: string | null = null;

    await db.begin(async (tx) => {
      if (isNew) {
        await tx`
          INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile)
          VALUES (${resolvedId}, ${projectId}, ${confidenceBand}, 'low', ${JSON.stringify(updatedProfile)}::jsonb)
          ON CONFLICT (id) DO NOTHING
        `;
      } else {
        await tx`
          UPDATE identities
          SET last_seen = now(),
              snapshot_count = snapshot_count + 1,
              confidence_band = ${confidenceBand},
              signal_profile = ${JSON.stringify(updatedProfile)}::jsonb
          WHERE id = ${resolvedId}
        `;
      }

      const [newSnap] = await tx<{ id: string }[]>`
        INSERT INTO snapshots
          (identity_id, project_id, event_id, timestamp, signals, signal_hash,
           persistence_policy, traceparent, client_ip)
        VALUES
          (${resolvedId}, ${projectId}, ${eventId}, ${snap.timestamp},
           ${tx.json(signals)}, ${signalHash},
           ${snap.persistencePolicy as PersistencePolicy},
           ${snap.traceparent ?? null},
           ${clientIp}::inet)
        RETURNING id
      `;
      if (newSnap) newSnapId = newSnap.id;

      // Drift: compute against the previous snapshot for this identity.
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
              (identity_id, before_snapshot_id, after_snapshot_id,
               classification, entropy, changed_signals, added_signals, removed_signals)
            VALUES
              (${resolvedId}, ${prevSnap[0].id}, ${newSnap.id},
               ${drift.classification}, ${drift.entropy},
               ${drift.changedSignals}, ${drift.addedSignals}, ${drift.removedSignals})
          `;
        }
      }

      // Cluster linking: if a second candidate also scored very highly, these two
      // stored identities are very likely the same real-world entity. Link them.
      if (!isNew && secondBest && secondBest.confidence >= CLUSTER_LINK_THRESHOLD) {
        await linkToCluster(tx, projectId, resolvedId, secondBest.identityId, secondBest.confidence);
      }
    });

    // Risk assessment runs outside the identity transaction so its DB writes
    // don't block the commit, and a detector failure can't roll back the snapshot.
    let risk = { score: 0, band: 'low', flags: [] as string[] };
    if (newSnapId) {
      const clusterId =
        (
          await db<{ cluster_id: string | null }[]>`
            SELECT cluster_id FROM identities WHERE id = ${resolvedId} LIMIT 1
          `
        )[0]?.cluster_id ?? null;

      const assessment = await assessRisk(db, {
        identityId: resolvedId,
        snapshotId: newSnapId,
        projectId,
        signals,
        signalHash,
        clusterId,
        clientIp,
        timestamp: snap.timestamp,
        isNew,
      });

      risk = {
        score: assessment.score,
        band: assessment.band,
        flags: assessment.flags.map((f) => f.code),
      };

      // Fire webhooks in the background — response is not gated on delivery.
      void deliverWebhooks(db, projectId, resolvedId, newSnapId, assessment);
    }

    results.push({ identityId: resolvedId, confidence: finalConfidence, isNew, continuity, risk, ...(ambiguous ? { ambiguous: true } : {}) });
  }

  res.json({ results });
});

// Link two identities into a cluster (or add to an existing one).
// The identity with an existing cluster_id takes precedence; otherwise a new
// cluster is created and both identities are assigned to it.
async function linkToCluster(
  tx: TransactionSql,
  projectId: string,
  identityIdA: string,
  identityIdB: string,
  confidence: number,
): Promise<void> {
  const rows = await tx<{ id: string; cluster_id: string | null }[]>`
    SELECT id, cluster_id FROM identities WHERE id IN (${identityIdA}, ${identityIdB})
  `;

  const a = rows.find((r) => r.id === identityIdA);
  const b = rows.find((r) => r.id === identityIdB);
  if (!a || !b) return;

  const existingClusterId = a.cluster_id ?? b.cluster_id;

  let clusterId: string;
  if (existingClusterId) {
    clusterId = existingClusterId;
  } else {
    const [cluster] = await tx<{ id: string }[]>`
      INSERT INTO clusters (project_id, reason)
      VALUES (${projectId}, 'high_confidence_signal_overlap')
      RETURNING id
    `;
    if (!cluster) return;
    clusterId = cluster.id;
  }

  // Update both identities to reference the cluster.
  await tx`
    UPDATE identities SET cluster_id = ${clusterId}
    WHERE id IN (${identityIdA}, ${identityIdB}) AND cluster_id IS NULL
  `;

  // Write audit entries for any identity newly assigned to this cluster.
  for (const { id, cluster_id } of [
    { id: identityIdA, cluster_id: a.cluster_id },
    { id: identityIdB, cluster_id: b.cluster_id },
  ]) {
    if (!cluster_id) {
      await tx`
        INSERT INTO cluster_merges (cluster_id, identity_id, confidence, reason)
        VALUES (${clusterId}, ${id}, ${confidence}, 'jaccard_similarity_above_threshold')
      `;
    }
  }
}
