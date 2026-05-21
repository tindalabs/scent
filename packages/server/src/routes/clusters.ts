import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const clustersRouter: IRouter = Router();

clustersRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;
  const clusterId = req.params['id']!;

  const [clusterRows, members] = await Promise.all([
    db<{ id: string; created_at: Date; reason: string }[]>`
      SELECT id, created_at, reason FROM clusters
      WHERE id = ${clusterId} AND project_id = ${projectId}
      LIMIT 1
    `,
    db<{
      id: string;
      first_seen: Date;
      last_seen: Date;
      confidence_band: string;
      risk_band: string;
      snapshot_count: number;
      merge_confidence: number | null;
      merge_reason: string | null;
    }[]>`
      SELECT
        i.id, i.first_seen, i.last_seen, i.confidence_band, i.risk_band, i.snapshot_count,
        cm.confidence AS merge_confidence,
        cm.reason AS merge_reason
      FROM identities i
      LEFT JOIN cluster_merges cm ON cm.identity_id = i.id AND cm.cluster_id = ${clusterId}
      WHERE i.cluster_id = ${clusterId} AND i.project_id = ${projectId}
      ORDER BY i.last_seen DESC
    `,
  ]);

  if (!clusterRows[0]) {
    res.status(404).json({ error: 'Cluster not found' });
    return;
  }

  res.json({
    cluster: clusterRows[0],
    members: members.map(m => ({
      ...m,
      merge_confidence: m.merge_confidence != null ? Number(m.merge_confidence) : null,
    })),
  });
});
