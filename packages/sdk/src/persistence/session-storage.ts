import type { StorageAdapter } from './types.js';

const KEY = '__scent_id';

export class SessionStorageAdapter implements StorageAdapter {
  readonly name = 'sessionStorage';

  isAvailable(): boolean {
    try {
      sessionStorage.setItem('__scent_probe', '1');
      sessionStorage.removeItem('__scent_probe');
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<string | null> {
    return sessionStorage.getItem(KEY);
  }

  async write(id: string): Promise<void> {
    sessionStorage.setItem(KEY, id);
  }

  async clear(): Promise<void> {
    sessionStorage.removeItem(KEY);
  }
}
