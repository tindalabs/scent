import { Router, type Request, type Response, type IRouter } from 'express';
import { trace } from '@opentelemetry/api';
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

  const identityId = req.params['id']!;

  const [identityRows, riskRows] = await Promise.all([
    db<{
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
      WHERE id = ${identityId} AND project_id = ${project[0].id}
      LIMIT 1
    `,
    db<{ score: number; flags: { code: string; label: string; reason: string; confidence: number }[] }[]>`
      SELECT score, flags
      FROM risk_assessments
      WHERE identity_id = ${identityId}
      ORDER BY timestamp DESC
      LIMIT 1
    `,
  ]);

  if (!identityRows[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  res.json({
    ...identityRows[0],
    riskScore: riskRows[0]?.score != null ? Number(riskRows[0].score) : null,
    riskFlags: riskRows[0]?.flags ?? [],
  });
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
    traceparent: string | null;
  }[]>`
    SELECT d.id, d.timestamp, d.classification, d.entropy,
           d.changed_signals, d.added_signals, d.removed_signals,
           d.before_snapshot_id, d.after_snapshot_id,
           s.traceparent
    FROM drifts d
    JOIN identities i ON i.id = d.identity_id
    JOIN snapshots s ON s.id = d.after_snapshot_id
    WHERE d.identity_id = ${req.params['id']!} AND i.project_id = ${project[0].id}
    ORDER BY d.timestamp ASC
  `;

  res.json({
    drifts: drifts.map(d => ({ ...d, entropy: Number(d.entropy) })),
  });
});

// Link the identity to an application-level account ID.
// Upserts the link record, incrementing link_count on repeated calls.
identityRouter.post('/:id/link', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const identityId = req.params['id']!;
  const { accountId } = req.body as { accountId?: string };
  if (!accountId || typeof accountId !== 'string') {
    res.status(400).json({ error: 'accountId is required' });
    return;
  }

  const identity = await db<{ id: string }[]>`
    SELECT id FROM identities WHERE id = ${identityId} AND project_id = ${project[0].id} LIMIT 1
  `;
  if (!identity[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  const [link] = await db<{ link_count: number }[]>`
    INSERT INTO identity_account_links (project_id, identity_id, account_id)
    VALUES (${project[0].id}, ${identityId}, ${accountId})
    ON CONFLICT (project_id, identity_id, account_id)
    DO UPDATE SET
      link_count     = identity_account_links.link_count + 1,
      last_linked_at = now()
    RETURNING link_count
  `;

  trace.getActiveSpan()?.setAttributes({
    'scent.identity.id': identityId,
    'scent.account.id': accountId,
    'scent.link_count': link?.link_count ?? 1,
  });

  res.json({ identityId, accountId, linkCount: link?.link_count ?? 1 });
});

// All account IDs ever linked to this Scent identity.
identityRouter.get('/:id/accounts', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key = ${apiKey} LIMIT 1
  `;
  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  const links = await db<{
    account_id: string;
    first_linked_at: Date;
    last_linked_at: Date;
    link_count: number;
  }[]>`
    SELECT account_id, first_linked_at, last_linked_at, link_count
    FROM identity_account_links
    WHERE project_id = ${project[0].id} AND identity_id = ${req.params['id']!}
    ORDER BY first_linked_at ASC
  `;

  res.json({ identityId: req.params['id'], accounts: links });
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
