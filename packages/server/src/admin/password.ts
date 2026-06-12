import bcrypt from 'bcryptjs';

// Admin passwords are low-entropy human secrets, so they get a slow, salted KDF
// (bcrypt) — deliberately different from the fast SHA-256 used for high-entropy API
// keys (see lib/api-key.ts). cost 12 is a sensible 2020s default.
const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
