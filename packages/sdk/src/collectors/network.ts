import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class NetworkCollector extends BaseCollector {
  readonly name = 'network';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number };
    };
    const conn = nav.connection;
    if (!conn) return Promise.resolve({});
    return Promise.resolve({
      ...(conn.effectiveType ? { 'network.type': conn.effectiveType } : {}),
      ...(typeof conn.downlink === 'number' ? { 'network.downlink': conn.downlink } : {}),
    });
  }
}
