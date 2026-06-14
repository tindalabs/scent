import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Symmetric encryption for secrets at rest (TOTP shared secrets). The key comes from
// SCENT_SECRET_KEY; any string is accepted and folded to a 32-byte key via SHA-256, so
// operators can use `openssl rand -hex 32` without worrying about exact byte length.
//
// 2FA is gated on this being configured: if SCENT_SECRET_KEY is unset, enrollment is
// refused (the server still runs) rather than storing secrets we can't protect.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer | null {
  const raw = process.env['SCENT_SECRET_KEY'];
  if (!raw) return null;
  return createHash('sha256').update(raw).digest(); // 32 bytes
}

export function isEncryptionConfigured(): boolean {
  return key() !== null;
}

// Returns base64(iv || authTag || ciphertext). Throws if the key isn't configured —
// callers gate on isEncryptionConfigured() first.
export function encrypt(plaintext: string): string {
  const k = key();
  if (!k) throw new Error('SCENT_SECRET_KEY is not configured');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(payload: string): string {
  const k = key();
  if (!k) throw new Error('SCENT_SECRET_KEY is not configured');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Test-only hook to clear any memoization — none today, but keeps parity with other
// env-driven modules and documents that the key is read fresh each call.
export function _resetCryptoForTests(): void {
  /* no-op: key() reads process.env on every call */
}
