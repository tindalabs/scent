import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('admin password hashing', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple'); // not plaintext
    expect(hash.startsWith('$2')).toBe(true); // bcrypt format
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword('not-it', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });
});
