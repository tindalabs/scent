import { randomBytes, createHash } from 'node:crypto';
import { authenticator } from 'otplib';

// TOTP (RFC 6238) via otplib, plus one-time recovery codes. The shared secret is
// encrypted at rest by crypto.ts; this module only deals in the base32 secret and the
// verification/recovery-code mechanics.

const ISSUER = 'Scent Observatory';
const RECOVERY_CODE_COUNT = 10;

// Accept the adjacent 30s steps too, tolerating clock skew between the server and the
// user's authenticator app (and step-boundary races).
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret(); // base32
}

// otpauth:// URI the authenticator app scans (rendered as a QR client-side).
export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

// Verify a 6-digit code against the secret. otplib allows a ±1 step window by default,
// tolerating minor clock skew.
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}

function hashRecoveryCode(code: string): string {
  // Normalize (case/spacing) before hashing so display formatting doesn't matter.
  const normalized = code.replace(/[\s-]/g, '').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

// Generate N human-friendly recovery codes (plaintext, shown once) and their hashes
// (stored). Format: xxxxx-xxxxx (10 hex chars).
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = randomBytes(5).toString('hex'); // 10 hex chars
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    codes.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { codes, hashes };
}

export { hashRecoveryCode };
