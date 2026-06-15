import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const dashboardRouter: IRouter = Router();

dashboardRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

  const [
    [totRow],
    [newRow],
    [highRiskRow],
    riskDist,
    driftTrend,
    [avgConfRow],
  ] = await Promise.all([
    db<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM identities WHERE project_id = ${projectId}
    `,
    db<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM identities
      WHERE project_id = ${projectId} AND first_seen >= NOW() - INTERVAL '1 day'
    `,
    db<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM identities
      WHERE project_id = ${projectId} AND risk_band IN ('high', 'critical')
    `,
    db<{ band: string; count: string }[]>`
      SELECT risk_band AS band, COUNT(*) AS count
      FROM identities
      WHERE project_id = ${projectId}
      GROUP BY risk_band
    `,
    db<{ date: string; count: string }[]>`
      SELECT TO_CHAR(d.timestamp::date, 'YYYY-MM-DD') AS date, COUNT(*) AS count
      FROM drifts d
      JOIN identities i ON i.id = d.identity_id
      WHERE i.project_id = ${projectId}
        AND d.timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY d.timestamp::date
      ORDER BY d.timestamp::date ASC
    `,
    // Average the per-identity confidence_band (high/medium/low/unknown — the
    // scoreToConfidenceBand vocabulary enforced by chk_confidence_band, NOT the
    // confirmed/probable/uncertain continuity labels) and map the mean rank back to a
    // band. Using the wrong vocabulary here made every row fall through to 1, so the
    // average was always < 1.5 and the card always read "unknown".
    db<{ avg_band: string | null }[]>`
      SELECT
        CASE
          WHEN AVG(
            CASE confidence_band
              WHEN 'high'   THEN 4
              WHEN 'medium' THEN 3
              WHEN 'low'    THEN 2
              ELSE 1
            END
          ) >= 3.5 THEN 'high'
          WHEN AVG(
            CASE confidence_band
              WHEN 'high'   THEN 4
              WHEN 'medium' THEN 3
              WHEN 'low'    THEN 2
              ELSE 1
            END
          ) >= 2.5 THEN 'medium'
          WHEN AVG(
            CASE confidence_band
              WHEN 'high'   THEN 4
              WHEN 'medium' THEN 3
              WHEN 'low'    THEN 2
              ELSE 1
            END
          ) >= 1.5 THEN 'low'
          ELSE 'unknown'
        END AS avg_band
      FROM identities
      WHERE project_id = ${projectId}
    `,
  ]);

  const allBands = ['low', 'medium', 'high', 'critical'];
  const distMap = Object.fromEntries(riskDist.map((r) => [r.band, parseInt(r.count, 10)]));

  res.json({
    totalIdentities: parseInt(totRow?.count ?? '0', 10),
    newToday: parseInt(newRow?.count ?? '0', 10),
    highRiskCount: parseInt(highRiskRow?.count ?? '0', 10),
    avgConfidenceBand: avgConfRow?.avg_band ?? 'unknown',
    riskDistribution: allBands.map((band) => ({ band, count: distMap[band] ?? 0 })),
    driftRateTrend: driftTrend.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
  });
});
