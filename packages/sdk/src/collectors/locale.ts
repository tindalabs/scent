import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class LocaleCollector extends BaseCollector {
  readonly name = 'locale';
  readonly stabilityClass = 'moderate' as const;

  collect(): Promise<SignalRecord> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const language = navigator.language;
    const languages = navigator.languages.join(',');
    return Promise.resolve({
      'locale.timezone': timezone,
      'locale.language': language,
      'locale.languages': languages,
    });
  }
}
