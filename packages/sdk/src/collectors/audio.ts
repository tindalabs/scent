import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

export class AudioCollector extends BaseCollector {
  readonly name = 'audio';
  readonly stabilityClass = 'stable' as const;

  async collect(): Promise<SignalRecord> {
    if (typeof OfflineAudioContext === 'undefined') return {};

    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const oscillator = ctx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    oscillator.connect(compressor);
    compressor.connect(ctx.destination);
    oscillator.start(0);

    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);

    // Hash a sample of the output buffer — stable across same audio engine,
    // distinct across different OS/browser audio implementations.
    let hash = 0;
    const step = Math.floor(data.length / 500);
    for (let i = 0; i < data.length; i += step) {
      hash = ((hash << 5) - hash + Math.round((data[i] ?? 0) * 1e10)) | 0;
    }

    return { 'audio.hash': (hash >>> 0).toString(36) };
  }
}
