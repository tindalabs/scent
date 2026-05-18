import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const accountRouter: IRouter = Router();

// All Scent identities ever linked to a given application account ID.
// This is the primary fraud-detection query: it answers "how many distinct
// identities (devices) have been associated with this account?" and,
// conversely, "what other accounts have been seen on the same device?"
accountRouter.get('/:accountId/identities', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const rows = await db<{
    identity_id: string;
    first_linked_at: Date;
    last_linked_at: Date;
    link_count: number;
    confidence_band: string;
    risk_band: string;
    snapshot_count: number;
  }[]>`
    SELECT
      l.identity_id,
      l.first_linked_at,
      l.last_linked_at,
      l.link_count,
      i.confidence_band,
      i.risk_band,
      i.snapshot_count
    FROM identity_account_links l
    JOIN identities i ON i.id = l.identity_id
    WHERE l.project_id = ${project[0].id}
      AND l.account_id = ${req.params['accountId']!}
    ORDER BY l.first_linked_at ASC
  `;

  res.json({ accountId: req.params['accountId'], identities: rows });
});
