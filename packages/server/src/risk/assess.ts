import type { Sql } from 'postgres';
import type { RiskFlag, RiskBand, SignalMap } from '@irregular/scent-engine';
import { detectAutomation, compositeRiskScore, scoreToRiskBand } from '@irregular/scent-engine';
import { detectEntropyInstability } from './detectors/entropy-instability.js';
import { detectStorageAmnesia } from './detectors/storage-amnesia.js';
import { detectRapidReregistration } from './detectors/rapid-reregistration.js';
import { detectImpossibleTransition } from './detectors/impossible-transition.js';
import { detectCoordinatedBehavior } from './detectors/coordinated-behavior.js';

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  flags: RiskFlag[];
}

export interface AssessContext {
  identityId: string;
  snapshotId: string;
  projectId: string;
  signals: SignalMap;
  signalHash: string;
  clusterId: string | null;
  clientIp: string | null;
  timestamp: string;
  isNew: boolean;
}

// Runs all detectors in parallel, combines results into a composite score,
// persists the risk_assessment record, and returns the assessment.
export async function assessRisk(sql: Sql, ctx: AssessContext): Promise<RiskAssessment> {
  const detectorResults = await Promise.all([
    Promise.resolve(detectAutomation(ctx.signals)),
    detectEntropyInstability(sql, ctx.identityId),
    detectStorageAmnesia(sql, ctx.identityId),
    detectRapidReregistration(sql, ctx.projectId, ctx.signalHash, ctx.identityId),
    detectImpossibleTransition(sql, ctx.identityId, ctx.clientIp, ctx.timestamp),
    detectCoordinatedBehavior(sql, ctx.projectId, ctx.identityId, ctx.signalHash, ctx.clusterId),
  ]);

  const flags = detectorResults.filter((r): r is RiskFlag => r !== null);
  const score = compositeRiskScore(flags);
  const band = scoreToRiskBand(score);

  await sql`
    INSERT INTO risk_assessments (identity_id, snapshot_id, score, band, flags)
    VALUES (
      ${ctx.identityId},
      ${ctx.snapshotId},
      ${score},
      ${band},
      ${JSON.stringify(flags)}::jsonb
    )
  `;

  // Denormalise the risk band onto the identity record for fast list queries.
  await sql`
    UPDATE identities SET risk_band = ${band} WHERE id = ${ctx.identityId}
  `;

  return { score, band, flags };
}
