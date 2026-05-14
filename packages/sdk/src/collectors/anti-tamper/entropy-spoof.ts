import { BaseCollector } from '../base.js';
import type { SignalRecord } from '../types.js';

// Natural canvas fingerprints are deterministic — the same drawing commands
// produce identical output every time. Anti-fingerprinting tools (e.g. Tor Browser,
// canvas-fingerprint-defender) add per-render random noise, making two
// identical draws produce different data URLs. We detect this by rendering twice.
export class EntropySpoofCollector extends BaseCollector {
  readonly name = 'anti-tamper.entropy-spoof';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    const render = (): string => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = 'rgb(100,120,200)';
      ctx.fillRect(0, 0, 100, 20);
      ctx.fillStyle = 'rgba(200,100,50,0.8)';
      ctx.font = '12px Arial';
      ctx.fillText('entropy probe', 2, 14);
      return canvas.toDataURL();
    };

    const a = render();
    const b = render();

    // Empty string means canvas is not supported — signal absent, not spoofed
    const spoofed = a !== '' && b !== '' && a !== b;

    return Promise.resolve({ 'tamper.canvas_noise_spoofed': spoofed });
  }
}
