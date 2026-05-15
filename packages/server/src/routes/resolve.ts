import { Router, type Request, type Response, type IRouter } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  computeSimHash,
  simHashToHex,
  hexToSimHash,
  hammingDistance,
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

  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }
  const projectId = project[0].id;

  const signals = parsed.data.signals as SignalMap;
  const simHash = computeSimHash(signals);

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
    if (hammingDistance(simHash, candidateHash) > SIMHASH_CANDIDATE_THRESHOLD) continue;

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

  // Merge inline automation flags with stored flags, deduplicate by code.
  const mergedFlags: RiskFlag[] = [...(storedRisk?.flags ?? [])];
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
