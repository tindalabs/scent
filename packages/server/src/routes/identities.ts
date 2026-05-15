import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const identitiesRouter: IRouter = Router();

const SORT_COLS = {
  last_seen: 'last_seen',
  first_seen: 'first_seen',
  snapshot_count: 'snapshot_count',
} as const;

identitiesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }
  const projectId = project[0].id;

  const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query['limit'] as string) ?? '50', 10)));
  const offset = (page - 1) * limit;
  const q = ((req.query['q'] as string) ?? '').trim();

  const rawSort = (req.query['sort'] as string) ?? 'last_seen';
  const col: string = SORT_COLS[rawSort as keyof typeof SORT_COLS] ?? 'last_seen';
  const dir = req.query['order'] === 'asc' ? 'ASC' : 'DESC';
  const orderClause = db.unsafe(`${col} ${dir}`);

  const [rows, [totRow]] = await Promise.all([
    q
      ? db<
          {
            id: string;
            first_seen: Date;
            last_seen: Date;
            confidence_band: string;
            risk_band: string;
            snapshot_count: number;
            cluster_id: string | null;
          }[]
        >`
          SELECT id, first_seen, last_seen, confidence_band, risk_band, snapshot_count, cluster_id
          FROM identities
          WHERE project_id = ${projectId} AND id ILIKE ${'%' + q + '%'}
          ORDER BY ${orderClause}
          LIMIT ${limit} OFFSET ${offset}
        `
      : db<
          {
            id: string;
            first_seen: Date;
            last_seen: Date;
            confidence_band: string;
            risk_band: string;
            snapshot_count: number;
            cluster_id: string | null;
          }[]
        >`
          SELECT id, first_seen, last_seen, confidence_band, risk_band, snapshot_count, cluster_id
          FROM identities
          WHERE project_id = ${projectId}
          ORDER BY ${orderClause}
          LIMIT ${limit} OFFSET ${offset}
        `,
    q
      ? db<{ count: string }[]>`
          SELECT COUNT(*) AS count FROM identities
          WHERE project_id = ${projectId} AND id ILIKE ${'%' + q + '%'}
        `
      : db<{ count: string }[]>`
          SELECT COUNT(*) AS count FROM identities WHERE project_id = ${projectId}
        `,
  ]);

  res.json({
    identities: rows,
    total: parseInt(totRow?.count ?? '0', 10),
    page,
    limit,
  });
});
