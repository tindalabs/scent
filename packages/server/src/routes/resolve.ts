import { Router, type Request, type Response, type IRouter } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  computeSimHash,
  simHashToHex,
  simHashToInt64,
  weightedJaccard,
  scoreToConfidenceBand,
  scoreToIdentityContinuity,
  detectAutomation,
  compositeRiskScore,
  scoreToRiskBand,
  SIMHASH_CANDIDATE_THRESHOLD,
} from '@tindalabs/scent-engine';
import type { SignalMap, RiskFlag } from '@tindalabs/scent-engine';

export const resolveRouter: IRouter = Router();

const ResolveSchema = z.object({
  signals: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

// POST /v1/resolve — submit a snapshot and get back identity + confidence + risk
// without persisting. Useful for login flow integration where you want to check
// confidence and risk before committing the observation to history.
resolveRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ResolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
    return;
  }

  const projectId = req.projectId;

  const signals = parsed.data.signals as SignalMap;
  const simHash = computeSimHash(signals);
  const simHashInt = simHashToInt64(simHash);

  // Same DB-side SimHash blocking pre-filter as POST /v1/events: only identities
  // within the Hamming threshold are returned, with their latest snapshot's
  // signals pulled via LATERAL for scoring.
  const candidates = await db<{ identity_id: string; timestamp: Date; signals: SignalMap }[]>`
    SELECT i.id AS identity_id, latest.timestamp, latest.signals
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

  let bestIdentityId: string | null = null;
  let bestConfidence = 0;

  for (const candidate of candidates) {
    const daysSince =
      (Date.now() - new Date(candidate.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    const { confidence } = weightedJaccard(signals, candidate.signals, daysSince);

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestIdentityId = candidate.identity_id;
    }
  }

  const isNew = bestIdentityId === null || bestConfidence < 0.35;
  const confidence = isNew ? 0 : bestConfidence;

  // Inline risk: automation detector runs on the submitted signals (pure function).
  // For a matched identity, also surface its most recent stored risk assessment.
  const inlineFlags: RiskFlag[] = [];
  const automationFlag = detectAutomation(signals);
  if (automationFlag) inlineFlags.push(automationFlag);

  let storedRisk: { score: number; band: string; flags: RiskFlag[] } | null = null;
  if (bestIdentityId) {
    const stored = await db<{ score: number; band: string; flags: RiskFlag[] }[]>`
      SELECT score, band, flags
      FROM risk_assessments
      WHERE identity_id = ${bestIdentityId}
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    if (stored[0]) storedRisk = stored[0];
  }

  // Merge inline automation flags with stored flags, deduplicate by code. Guard that
  // stored flags is actually an array — legacy rows (pre-fix) double-encoded it as a
  // JSON string, and spreading a string would explode into per-character garbage.
  const storedFlags = Array.isArray(storedRisk?.flags) ? storedRisk.flags : [];
  const mergedFlags: RiskFlag[] = [...storedFlags];
  for (const flag of inlineFlags) {
    if (!mergedFlags.some((f) => f.code === flag.code)) {
      mergedFlags.push(flag);
    }
  }

  const riskScore = compositeRiskScore(mergedFlags);
  const riskBand = scoreToRiskBand(riskScore);

  res.json({
    identityId: isNew ? null : bestIdentityId,
    confidence,
    confidenceBand: scoreToConfidenceBand(confidence),
    continuity: scoreToIdentityContinuity(confidence),
    isNew,
    signalHash: simHashToHex(simHash),
    risk: {
      score: riskScore,
      band: riskBand,
      flags: mergedFlags.map((f) => ({ code: f.code, label: f.label, reason: f.reason, confidence: f.confidence })),
    },
  });
});
