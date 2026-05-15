import { describe, it, expect } from 'vitest';
import { detectAutomation } from './automation.js';

describe('detectAutomation', () => {
  it('returns null when no tamper signals are active', () => {
    expect(detectAutomation({ 'canvas.2d': 'abc', 'screen.width': 1920 })).toBeNull();
  });

  it('returns null when tamper signals are false', () => {
    expect(detectAutomation({ 'tamper.webdriver': false, 'tamper.cdp': false })).toBeNull();
  });

  it('returns high confidence for webdriver alone', () => {
    const flag = detectAutomation({ 'tamper.webdriver': true });
    expect(flag).not.toBeNull();
    expect(flag!.code).toBe('automation_suspected');
    expect(flag!.confidence).toBeGreaterThan(0.85);
  });

  it('confidence increases with multiple active signals', () => {
    const single = detectAutomation({ 'tamper.webdriver': true });
    const multiple = detectAutomation({
      'tamper.webdriver': true,
      'tamper.headless_chrome': true,
      'tamper.no_plugins': true,
    });
    expect(multiple!.confidence).toBeGreaterThan(single!.confidence);
  });

  it('low-confidence devtools_open alone does not look like automation', () => {
    const flag = detectAutomation({ 'tamper.devtools_open': true });
    expect(flag).not.toBeNull();
    expect(flag!.confidence).toBeLessThan(0.30);
  });

  it('caps confidence below 1.0', () => {
    const allSignals = Object.fromEntries(
      ['tamper.webdriver', 'tamper.cdp', 'tamper.playwright', 'tamper.headless_chrome',
       'tamper.canvas_patched', 'tamper.canvas_noise_spoofed'].map((k) => [k, true]),
    );
    const flag = detectAutomation(allSignals);
    expect(flag!.confidence).toBeLessThan(1.0);
  });
});
