export interface StorageAdapter {
  readonly name: string;
  read(): Promise<string | null>;
  write(id: string): Promise<void>;
  clear(): Promise<void>;
  isAvailable(): boolean;
}
