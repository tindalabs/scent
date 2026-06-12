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

  // Hash before it touches the DB or Redis — the plaintext key is never stored.
  const keyHash = hashApiKey(apiKey);
  const cacheKey = `proj:${keyHash}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    req.projectId = cached;
    next();
    return;
  }

  const project = await db<{ id: string }[]>`
    SELECT id FROM projects WHERE api_key_hash = ${keyHash} LIMIT 1
  `;

  if (!project[0]) {
    res.status(401).json({ error: 'Unknown API key' });
    return;
  }

  await redis.set(cacheKey, project[0].id, 'EX', CACHE_TTL_SECONDS);
  req.projectId = project[0].id;
  next();
}
