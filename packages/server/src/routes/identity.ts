import { Router, type Request, type Response, type IRouter } from 'express';
import { db } from '../db/client.js';

export const identityRouter: IRouter = Router();

// Full identity record: confidence, risk, last snapshot summary.
identityRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const identity = await db<{
    id: string;
    first_seen: Date;
    last_seen: Date;
    confidence_band: string;
    risk_band: string;
    snapshot_count: number;
    cluster_id: string | null;
  }[]>`
    SELECT id, first_seen, last_seen, confidence_band, risk_band, snapshot_count, cluster_id
    FROM identities
    WHERE id = ${req.params['id']!} AND project_id = ${project[0].id}
    LIMIT 1
  `;

  if (!identity[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  res.json(identity[0]);
});

// Ordered drift history for an identity.
identityRouter.get('/:id/timeline', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const drifts = await db<{
    id: string;
    timestamp: Date;
    classification: string;
    entropy: number;
    changed_signals: string[];
    added_signals: string[];
    removed_signals: string[];
    before_snapshot_id: string;
    after_snapshot_id: string;
  }[]>`
    SELECT d.id, d.timestamp, d.classification, d.entropy,
           d.changed_signals, d.added_signals, d.removed_signals,
           d.before_snapshot_id, d.after_snapshot_id
    FROM drifts d
    JOIN identities i ON i.id = d.identity_id
    WHERE d.identity_id = ${req.params['id']!} AND i.project_id = ${project[0].id}
    ORDER BY d.timestamp ASC
  `;

  res.json({ drifts });
});

// Current signal profile with per-signal explainability metadata.
identityRouter.get('/:id/signals', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const snap = await db<{ signals: Record<string, unknown>; timestamp: Date }[]>`
    SELECT s.signals, s.timestamp
    FROM snapshots s
    JOIN identities i ON i.id = s.identity_id
    WHERE s.identity_id = ${req.params['id']!} AND i.project_id = ${project[0].id}
    ORDER BY s.timestamp DESC
    LIMIT 1
  `;

  if (!snap[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  res.json({ signals: snap[0].signals, asOf: snap[0].timestamp });
});
