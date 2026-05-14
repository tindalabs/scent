import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class PluginCollector extends BaseCollector {
  readonly name = 'plugins';
  readonly stabilityClass = 'moderate' as const;

  collect(): Promise<SignalRecord> {
    const plugins = Array.from(navigator.plugins)
      .map((p) => p.name)
      .sort()
      .join(',');
    return Promise.resolve(plugins ? { 'plugins.list': plugins } : {});
  }
}
