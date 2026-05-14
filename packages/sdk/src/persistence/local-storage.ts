import type { StorageAdapter } from './types.js';

const KEY = '__scent_id';

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';

  isAvailable(): boolean {
    try {
      localStorage.setItem('__scent_probe', '1');
      localStorage.removeItem('__scent_probe');
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<string | null> {
    return localStorage.getItem(KEY);
  }

  async write(id: string): Promise<void> {
    localStorage.setItem(KEY, id);
  }

  async clear(): Promise<void> {
    localStorage.removeItem(KEY);
  }
}
