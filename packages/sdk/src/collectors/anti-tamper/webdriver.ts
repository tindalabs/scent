import { BaseCollector } from '../base.js';
import type { SignalRecord } from '../types.js';

// Artifacts left by WebDriver, Selenium, Playwright, and Chrome DevTools Protocol.
// Each property is checked individually so the server can weight them separately.
const CDP_ARTIFACTS = [
  '__cdc_asdjflasutopfhvcZLmcfl_',
  '__webdriver_evaluate',
  '__selenium_evaluate',
  '__webdriver_script_function',
  '__webdriver_script_func',
  '$chrome_asyncScriptInfo',
  '$cdc_asdjflasutopfhvcZLmcfl_',
] as const;

export class WebDriverCollector extends BaseCollector {
  readonly name = 'anti-tamper.webdriver';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    const webdriver = navigator.webdriver === true;

    const cdpArtifacts = CDP_ARTIFACTS.some(
      (key) => key in window || key in document,
    );

    // Playwright injects __playwright or __pw_manual
    const playwrightArtifacts =
      '__playwright' in window || '__pw_manual' in window;

    return Promise.resolve({
      'tamper.webdriver': webdriver,
      'tamper.cdp': cdpArtifacts,
      'tamper.playwright': playwrightArtifacts,
    });
  }
}
