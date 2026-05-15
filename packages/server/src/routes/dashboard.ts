import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const dashboardRouter: IRouter = Router();

dashboardRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }
  const projectId = project[0].id;

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
    db<{ avg_band: string | null }[]>`
      SELECT
        CASE
          WHEN AVG(
            CASE confidence_band
              WHEN 'confirmed' THEN 4
              WHEN 'probable'  THEN 3
              WHEN 'uncertain' THEN 2
              ELSE 1
            END
          ) >= 3.5 THEN 'confirmed'
          WHEN AVG(
            CASE confidence_band
              WHEN 'confirmed' THEN 4
              WHEN 'probable'  THEN 3
              WHEN 'uncertain' THEN 2
              ELSE 1
            END
          ) >= 2.5 THEN 'probable'
          WHEN AVG(
            CASE confidence_band
              WHEN 'confirmed' THEN 4
              WHEN 'probable'  THEN 3
              WHEN 'uncertain' THEN 2
              ELSE 1
            END
          ) >= 1.5 THEN 'uncertain'
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
