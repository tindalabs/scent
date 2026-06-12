import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis.js';
import { hashApiKey } from './api-key.js';

// Fixed-window rate limiting keyed on the validated API key.
// 1000 requests per 60-second window per project.
const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 1000;

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey !== 'string' || !apiKey) {
    res.status(401).json({ error: 'Missing X-Api-Key header' });
    return;
  }

  // Bucket on the key hash, not the plaintext, so raw keys never appear in Redis.
  const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `rl:${hashApiKey(apiKey)}:${window}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - count));

  if (count > MAX_REQUESTS) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  next();
}
