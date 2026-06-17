import { trace } from '@opentelemetry/api';
import type { Sql, TransactionSql } from 'postgres';
import { deriveEventId } from '../schemas/events.js';
import type { SnapshotPayload } from '../schemas/events.js';
import {
  computeSimHash,
  simHashToHex,
  simHashToInt64,
  weightedJaccard,
  scoreToConfidenceBand,
  scoreToIdentityContinuity,
  diffSnapshots,
  SIMHASH_CANDIDATE_THRESHOLD,
} from '@tindalabs/scent-engine';
import type { SignalMap, PersistencePolicy, IdentityContinuity } from '@tindalabs/scent-engine';
import { absenceWeightOverrides, updateSignalProfile } from '../engine/signal-profile.js';
import type { SignalProfile } from '../engine/signal-profile.js';
import { minimizeIp } from '../lib/minimize-ip.js';
import { assessRisk } from '../risk/assess.js';
import { deliverWebhooks } from '../risk/webhook.js';

const tracer = trace.getTracer('scent-server');

// Confidence threshold above which a second candidate is considered an
// ambiguous match (one snapshot plausibly matching two stored identities).
const AMBIGUOUS_MATCH_THRESHOLD = 0.6;

// Confidence above which two distinct stored identities are considered the
// same real-world entity and should be linked into a cluster.
const CLUSTER_LINK_THRESHOLD = 0.9;

export interface ResolveSnapshotInput {
  projectId: string;
  snap: SnapshotPayload;
  clientIp: string | null;
}

export interface ResolveSnapshotResult {
  identityId: string;
  confidence: number;
  isNew: boolean;
  continuity: IdentityContinuity;
  risk: { score: number; band: string; flags: string[] };
  ambiguous?: boolean;
}

// Runs the full per-snapshot resolution pipeline: idempotent dedup → SimHash
// candidate retrieval → scoring → identity tx (insert/update + snapshot + drift +
// cluster linking) → out-of-band risk assessment + webhooks. Extracted from the
// POST /v1/events route so it can run in the background worker (async ingest) while
// POST /v1/resolve and tests can also call it directly.
export async function resolveSnapshot(
  db: Sql,
  { projectId, snap, clientIp }: ResolveSnapshotInput,
): Promise<ResolveSnapshotResult> {
  return tracer.startActiveSpan('scent.identity_resolution', async (span) => {
    try {
      span.setAttribute('scent.identity.input_id', snap.identityId);
      if (snap.traceparent) span.setAttribute('scent.traceparent', snap.traceparent);

      const eventId = deriveEventId(snap.identityId, snap.timestamp);

      // Idempotent deduplication: identical event_id is a no-op. This also makes
      // BullMQ at-least-once retries safe — a re-run of the same job is absorbed here.
      const existing = await db<{ id: string }[]>`
        SELECT id FROM snapshots WHERE event_id = ${eventId} LIMIT 1
      `;
      if (existing[0]) {
        span.setAttribute('scent.identity.deduplicated', true);
        return {
          identityId: snap.identityId,
          confidence: 1,
          isNew: false,
          continuity: 'confirmed' as const,
          risk: { score: 0, band: 'low', flags: [] },
        };
      }

      const signals = snap.signals as SignalMap;
      const simHash = computeSimHash(signals);
      const signalHash = simHashToHex(simHash);
      const simHashInt = simHashToInt64(simHash);

      // Project data-lifecycle settings (ADR-0004): whether to store the full IP, and
      // the lawful basis to record when the snapshot didn't carry one.
      const [projSettings] = await db<{ store_full_ip: boolean; lawful_basis_default: string }[]>`
        SELECT store_full_ip, lawful_basis_default FROM projects WHERE id = ${projectId} LIMIT 1
      `;
      const storedIp = minimizeIp(clientIp, projSettings?.store_full_ip ?? false);
      const lawfulBasis = snap.lawfulBasis ?? projSettings?.lawful_basis_default ?? 'consent';
      const consentVersion = snap.consentVersion ?? null;
      const consentedAt = snap.consentedAt ?? null;

      // Decision + write happen inside one transaction guarded by a per-fingerprint
      // advisory lock. Without it, concurrent ingest jobs for an identical brand-new
      // device each run their candidate lookup before any sibling commits, all miss,
      // and fan out into duplicate "new" identities (orphaned rows: snapshot_count=0,
      // band 'unknown'). With it, the second job blocks until the first commits, so its
      // candidate query then sees the new identity and matches it. Distinct fingerprints
      // lock on distinct keys and still resolve in parallel; the lock auto-releases at
      // COMMIT/ROLLBACK.
      const lockKey = `${projectId}|${signalHash}`;

      // Assigned inside the transaction, read afterwards for the response, span
      // attributes, and the out-of-band risk assessment.
      let isNew = true;
      let resolvedId = snap.identityId;
      let finalConfidence = 0;
      let ambiguous = false;
      let newSnapId: string | null = null;

      await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

        // Candidate retrieval: pre-filter on the denormalized latest_signal_hash,
        // returning only identities whose SimHash is within the Hamming threshold
        // (bit_count of the XOR); survivors' signals/profile come via LATERAL. Runs
        // inside the lock so it observes a sibling identity committed a moment earlier.
        const candidates = await tx<{
          identity_id: string;
          timestamp: Date;
          signals: SignalMap;
          signal_profile: SignalProfile;
        }[]>`
          SELECT i.id AS identity_id, latest.timestamp, latest.signals, i.signal_profile
          FROM identities i
          JOIN LATERAL (
            SELECT signals, timestamp
            FROM snapshots
            WHERE identity_id = i.id
            ORDER BY timestamp DESC
            LIMIT 1
          ) latest ON true
          WHERE i.project_id = ${projectId}
            AND i.latest_signal_hash IS NOT NULL
            AND bit_count((i.latest_signal_hash # ${simHashInt.toString()}::bigint)::bit(64)) <= ${SIMHASH_CANDIDATE_THRESHOLD}
        `;

        // Score every candidate that survived the DB pre-filter.
        const scored: Array<{ identityId: string; confidence: number }> = [];
        for (const candidate of candidates) {
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
        scored.sort((a, b) => b.confidence - a.confidence);

        const best = scored[0];
        const secondBest = scored[1];

        // A confident best match flips the new-identity defaults set above; otherwise
        // this stays a new identity keyed on the SDK-provided id. The `if` also narrows
        // `best` to defined for the field reads.
        if (best && best.confidence >= 0.35) {
          isNew = false;
          resolvedId = best.identityId;
          finalConfidence = best.confidence;
        }

        // Flag ambiguous matches: two candidates both above the ambiguity threshold.
        ambiguous =
          !isNew &&
          secondBest !== undefined &&
          secondBest.confidence >= AMBIGUOUS_MATCH_THRESHOLD;

        const confidenceBand = scoreToConfidenceBand(finalConfidence);

        // Look up the stored signal_profile for the resolved identity (may be new).
        const storedProfile = isNew
          ? {}
          : ((
              await tx<{ signal_profile: SignalProfile }[]>`
                SELECT signal_profile FROM identities WHERE id = ${resolvedId} LIMIT 1
              `
            )[0]?.signal_profile ?? {});
        const updatedProfile = updateSignalProfile(storedProfile, signals, snap.timestamp);

        if (isNew) {
          await tx`
            INSERT INTO identities (id, project_id, confidence_band, risk_band, signal_profile, latest_signal_hash)
            VALUES (${resolvedId}, ${projectId}, ${confidenceBand}, 'low', ${tx.json(updatedProfile as unknown as import('postgres').JSONValue)}, ${simHashInt.toString()}::bigint)
            ON CONFLICT (id) DO NOTHING
          `;
        } else {
          await tx`
            UPDATE identities
            SET last_seen = now(),
                snapshot_count = snapshot_count + 1,
                confidence_band = ${confidenceBand},
                signal_profile = ${tx.json(updatedProfile as unknown as import('postgres').JSONValue)},
                latest_signal_hash = ${simHashInt.toString()}::bigint
            WHERE id = ${resolvedId}
          `;
        }

        const [newSnap] = await tx<{ id: string }[]>`
          INSERT INTO snapshots
            (identity_id, project_id, event_id, timestamp, signals, signal_hash,
             persistence_policy, traceparent, client_ip,
             lawful_basis, consent_version, consented_at)
          VALUES
            (${resolvedId}, ${projectId}, ${eventId}, ${snap.timestamp},
             ${tx.json(signals)}, ${signalHash},
             ${snap.persistencePolicy as PersistencePolicy},
             ${snap.traceparent ?? null},
             ${storedIp}::inet,
             ${lawfulBasis}, ${consentVersion}, ${consentedAt})
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

      const continuity = scoreToIdentityContinuity(finalConfidence);

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

      span.setAttributes({
        'scent.identity.id': resolvedId,
        'scent.identity.is_new': isNew,
        'scent.identity.confidence': finalConfidence,
      });

      return {
        identityId: resolvedId,
        confidence: finalConfidence,
        isNew,
        continuity,
        risk,
        ...(ambiguous ? { ambiguous: true } : {}),
      };
    } finally {
      span.end();
    }
  });
}

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
