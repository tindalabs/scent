import { randomBytes } from 'node:crypto';
import { hashApiKey } from '../middleware/api-key.js';

export interface MintedKey {
  /** The plaintext key — show once to the operator, never persist. */
  apiKey: string;
  /** SHA-256 of the key; this is what's stored and looked up. */
  keyHash: string;
  /** Non-secret leading chars, stored for display in the management UI. */
  keyPrefix: string;
}

// Generate a fresh API key: 32 random bytes (256-bit) as 64 hex chars, plus its
// stored hash and a short non-secret prefix. Shared by the create-project CLI and
// the admin create/rotate endpoints.
export function mintApiKey(): MintedKey {
  const apiKey = randomBytes(32).toString('hex');
  return { apiKey, keyHash: hashApiKey(apiKey), keyPrefix: apiKey.slice(0, 8) };
}
