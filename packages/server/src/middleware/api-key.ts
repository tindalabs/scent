import { createHash } from 'node:crypto';

// API keys are stored only as a SHA-256 hash — never in plaintext (DB, Redis cache,
// or rate-limit buckets). A plain fast hash is correct here (unlike passwords): keys
// are high-entropy random tokens, so there's no rainbow-table/brute-force risk, and
// O(1) lookup by hash is required for auth. The plaintext is shown to the operator
// once at creation (see scripts/create-project.ts) and never persisted.
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
