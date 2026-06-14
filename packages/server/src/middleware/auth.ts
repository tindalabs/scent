import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis.js';
import { db } from '../db/client.js';
import { hashApiKey } from './api-key.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      projectId: string;
    }
  }
}

// Resolved project IDs are cached in Redis for 5 minutes to eliminate the
// per-request DB round-trip on every /v1/* route.
const CACHE_TTL_SECONDS = 300;

// Resolve a plaintext API key to its project ID, or null if the key is unknown.
// The lookup is cached in Redis (`proj:<keyhash>`); rotate/revoke in routes/admin.ts
// busts that cache so a killed key stops authenticating immediately. Shared by
// requireApiKey (ingest/resolve) and requireProjectRead (the read routes).
export async function resolveProjectByKey(apiKey: string): Promise<string | null> {
  // Hash before it touches the DB or Redis — the plaintext key is never stored.
  const keyHash = hashApiKey(apiKey);
  const cacheKey = `proj:${keyHash}`;

  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key_hash = ${keyHash} LIMIT 1
  `;
  if (!project[0]) return null;

  await redis.set(cacheKey, project[0].id, 'EX', CACHE_TTL_SECONDS);
  return project[0].id;
}

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey !== 'string' || !apiKey) {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }

  const projectId = await resolveProjectByKey(apiKey);
  if (!projectId) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  req.projectId = projectId;
  next();
}
