import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import { hashApiKey } from './api-key.js';
import { resolveProjectByKey } from './auth.js';
import { incrFixedWindow } from './rate-limit.js';
import { validateSession, SESSION_COOKIE } from '../admin/session.js';

// Authorizes the /v1 READ routes (dashboard, identities, identity, clusters,
// accounts) via EITHER of two paths, then sets req.projectId for the handlers —
// which are auth-agnostic and just read it:
//
//   1. Project API key (X-Api-Key) — the programmatic path, used by SDKs/backends.
//      Works for any method.
//   2. Admin session cookie + X-Project-Id header — the Observatory path, so a
//      logged-in operator can view any project without a baked-in key. GET only:
//      a session must never reach a write path (ingest, account linking). Writes
//      under these routers therefore still require a project key.
//
// Ingest (/v1/events) and synchronous resolve (/v1/resolve) deliberately do NOT use
// this — they stay strictly key-gated via requireApiKey.

const PROJECT_ID_HEADER = 'x-project-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limits mirror requireApiKey/rateLimitMiddleware: per-key for the key path, and a
// per-admin-user bucket for the session path (login-gated, so this just bounds abuse
// from a compromised session rather than open traffic).
const KEY_MAX_REQUESTS = 1000;
const SESSION_MAX_REQUESTS = 600;

export async function requireProjectRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];

  // Path 1: project API key.
  if (typeof apiKey === 'string' && apiKey) {
    const count = await incrFixedWindow(`rl:${hashApiKey(apiKey)}`);
    res.setHeader('X-RateLimit-Limit', KEY_MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, KEY_MAX_REQUESTS - count));
    if (count > KEY_MAX_REQUESTS) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const projectId = await resolveProjectByKey(apiKey);
    if (!projectId) {
      res.status(401).json({ error: 'Unknown API key' });
      return;
    }
    req.projectId = projectId;
    next();
    return;
  }

  // Path 2: admin session + selected project. Read-only — a session can't write.
  if (req.method !== 'GET') {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }

  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const user = token ? await validateSession(token) : null;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const count = await incrFixedWindow(`rl:user:${user.id}`);
  if (count > SESSION_MAX_REQUESTS) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  const projectId = req.headers[PROJECT_ID_HEADER];
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
    res.status(400).json({ error: 'Missing or invalid X-Project-Id header' });
    return;
  }

  // Any authenticated admin may view any project — consistent with the admin API,
  // which lets any admin manage every project (admin_users has no per-project ACL).
  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE id = ${projectId} LIMIT 1
  `;
  if (!project[0]) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  req.projectId = projectId;
  next();
}
