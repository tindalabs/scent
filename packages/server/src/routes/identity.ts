import { Router, type Request, type Response, type IRouter } from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { db } from '../db/client.js';

const tracer = trace.getTracer('scent-server');

export const identityRouter: IRouter = Router();

// Full identity record: confidence, risk, last snapshot summary.
identityRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

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
      WHERE id = ${identityId} AND project_id = ${projectId}
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
    riskFlags: (() => {
      const f = riskRows[0]?.flags;
      if (!f) return [];
      if (typeof f === 'string') return JSON.parse(f);
      return f;
    })(),
  });
});

// Ordered drift history for an identity.
identityRouter.get('/:id/timeline', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

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
    WHERE d.identity_id = ${req.params['id']!} AND i.project_id = ${projectId}
    ORDER BY d.timestamp ASC
  `;

  res.json({
    drifts: drifts.map(d => ({ ...d, entropy: Number(d.entropy) })),
  });
});

// Link the identity to an application-level account ID.
// Upserts the link record, incrementing link_count on repeated calls.
identityRouter.post('/:id/link', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

  const identityId = req.params['id']!;
  const { accountId } = req.body as { accountId?: string };
  if (!accountId || typeof accountId !== 'string') {
    res.status(400).json({ error: 'accountId is required' });
    return;
  }

  const identity = await db<{ id: string }[]>`
    SELECT id FROM identities WHERE id = ${identityId} AND project_id = ${projectId} LIMIT 1
  `;
  if (!identity[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  const span = tracer.startSpan('scent.identity_link');
  try {
    const [link] = await db<{ link_count: number }[]>`
      INSERT INTO identity_account_links (project_id, identity_id, account_id)
      VALUES (${projectId}, ${identityId}, ${accountId})
      ON CONFLICT (project_id, identity_id, account_id)
      DO UPDATE SET
        link_count     = identity_account_links.link_count + 1,
        last_linked_at = now()
      RETURNING link_count
    `;
    const linkCount = link?.link_count ?? 1;
    span.setAttributes({
      'scent.identity.id': identityId,
      'scent.account.id': accountId,
      'scent.link_count': linkCount,
    });
    span.end();
    res.json({ identityId, accountId, linkCount });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw err;
  }
});

// All account IDs ever linked to this Scent identity.
identityRouter.get('/:id/accounts', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

  const links = await db<{
    account_id: string;
    first_linked_at: Date;
    last_linked_at: Date;
    link_count: number;
  }[]>`
    SELECT account_id, first_linked_at, last_linked_at, link_count
    FROM identity_account_links
    WHERE project_id = ${projectId} AND identity_id = ${req.params['id']!}
    ORDER BY first_linked_at ASC
  `;

  res.json({ identityId: req.params['id'], accounts: links });
});

// GDPR Art. 17 (right to erasure): delete the identity and everything held about it.
// Snapshots, drifts, risk assessments, cluster merges, and account links all cascade
// (ON DELETE CASCADE on identity_id). Project-scoped. Strictly key-gated: a non-GET
// never reaches here via an admin session (requireProjectRead returns 401), so an
// operator must use a project key to erase.
identityRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;
  const deleted = await db<{ id: string }[]>`
    DELETE FROM identities
    WHERE id = ${req.params['id']!} AND project_id = ${projectId}
    RETURNING id
  `;
  if (!deleted[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }
  res.status(204).end();
});

// GDPR Art. 20 (data portability): everything held about an identity, as one JSON
// bundle — the identity record plus its snapshots (with consent provenance), drifts,
// risk assessments, and linked accounts.
identityRouter.get('/:id/export', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;
  const identityId = req.params['id']!;

  const [identity] = await db`
    SELECT id, first_seen, last_seen, confidence_band, risk_band, snapshot_count, cluster_id
    FROM identities WHERE id = ${identityId} AND project_id = ${projectId} LIMIT 1
  `;
  if (!identity) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  const [snapshots, drifts, riskAssessments, accounts] = await Promise.all([
    db`
      SELECT id, timestamp, signals, signal_hash, persistence_policy, traceparent,
             host(client_ip) AS client_ip, lawful_basis, consent_version, consented_at
      FROM snapshots WHERE identity_id = ${identityId} ORDER BY timestamp ASC
    `,
    db`
      SELECT id, timestamp, classification, entropy,
             changed_signals, added_signals, removed_signals
      FROM drifts WHERE identity_id = ${identityId} ORDER BY timestamp ASC
    `,
    db`
      SELECT id, timestamp, score, band, flags
      FROM risk_assessments WHERE identity_id = ${identityId} ORDER BY timestamp ASC
    `,
    db`
      SELECT account_id, first_linked_at, last_linked_at, link_count
      FROM identity_account_links
      WHERE project_id = ${projectId} AND identity_id = ${identityId}
      ORDER BY first_linked_at ASC
    `,
  ]);

  res.json({ identity, snapshots, drifts, riskAssessments, accounts });
});

// Current signal profile with per-signal explainability metadata.
identityRouter.get('/:id/signals', async (req: Request, res: Response): Promise<void> => {
  const projectId = req.projectId;

  const snap = await db<{ signals: Record<string, unknown>; timestamp: Date }[]>`
    SELECT s.signals, s.timestamp
    FROM snapshots s
    JOIN identities i ON i.id = s.identity_id
    WHERE s.identity_id = ${req.params['id']!} AND i.project_id = ${projectId}
    ORDER BY s.timestamp DESC
    LIMIT 1
  `;

  if (!snap[0]) {
    res.status(404).json({ error: 'Identity not found' });
    return;
  }

  res.json({ signals: snap[0].signals, asOf: snap[0].timestamp });
});
