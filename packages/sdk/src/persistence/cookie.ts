import type { StorageAdapter } from './types.js';

const COOKIE_NAME = '__scent_id';
// 1 year TTL — long enough to be meaningful, short enough to be defensible legally
const MAX_AGE = 365 * 24 * 60 * 60;

export class CookieAdapter implements StorageAdapter {
  readonly name = 'cookie';

  isAvailable(): boolean {
    return navigator.cookieEnabled;
  }

  async read(): Promise<string | null> {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`),
    );
    return match?.[1] ?? null;
  }

  async write(id: string): Promise<void> {
    document.cookie = `${COOKIE_NAME}=${id}; max-age=${MAX_AGE}; SameSite=Strict; path=/`;
  }

  async clear(): Promise<void> {
    document.cookie = `${COOKIE_NAME}=; max-age=0; path=/`;
  }
}
