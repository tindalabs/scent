import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const accountsRouter: IRouter = Router();

// Account clusters — the at-a-glance fraud-investigation surface.
// Each row is one Scent identity (one device/operator) that has been linked to
// MORE THAN ONE application account: the free-trial / multi-account abuse pattern.
// Returns the distinct-account count, the linked account IDs, and the identity's
// current risk band, ordered by account count (most-shared devices first).
//
// `?min=` (default 2) raises the threshold for narrowing to heavier offenders.
accountsRouter.get('/clusters', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

  const minRaw = Number(req.query['min']);
  const minAccounts = Number.isFinite(minRaw) && minRaw >= 2 ? Math.floor(minRaw) : 2;

  const clusters = await db<{
    identity_id: string;
    account_count: number;
    total_links: number;
    first_linked_at: Date;
    last_linked_at: Date;
    risk_band: string;
    confidence_band: string;
    account_ids: string[];
  }[]>`
    SELECT
      l.identity_id,
      COUNT(DISTINCT l.account_id)::int AS account_count,
      SUM(l.link_count)::int            AS total_links,
      MIN(l.first_linked_at)            AS first_linked_at,
      MAX(l.last_linked_at)             AS last_linked_at,
      i.risk_band,
      i.confidence_band,
      ARRAY_AGG(DISTINCT l.account_id)  AS account_ids
    FROM identity_account_links l
    JOIN identities i ON i.id = l.identity_id
    WHERE l.project_id = ${projectId}
    GROUP BY l.identity_id, i.risk_band, i.confidence_band
    HAVING COUNT(DISTINCT l.account_id) >= ${minAccounts}
    ORDER BY account_count DESC, last_linked_at DESC
    LIMIT 100
  `;

  res.json({ minAccounts, clusters });
});
