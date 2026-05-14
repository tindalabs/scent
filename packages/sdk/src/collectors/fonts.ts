import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

// A curated cross-platform list. Sorted for deterministic output.
const FONTS = [
  'American Typewriter', 'Andale Mono', 'Arial', 'Arial Hebrew', 'Arial Narrow',
  'Baskerville', 'Big Caslon', 'Bodoni 72', 'Brush Script MT',
  'Calibri', 'Cambria', 'Candara', 'Chalkboard SE', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Copperplate', 'Corbel', 'Courier New',
  'DejaVu Sans', 'DejaVu Serif', 'Didot', 'Futura',
  'Geneva', 'Georgia', 'Gill Sans', 'Helvetica Neue', 'Herculanum',
  'Hoefler Text', 'Impact', 'Liberation Mono', 'Liberation Sans',
  'Lucida Console', 'Lucida Grande', 'Lucida Sans Unicode',
  'Marker Felt', 'Menlo', 'Monaco', 'Noteworthy', 'Optima',
  'Papyrus', 'Rockwell', 'Segoe Print', 'Segoe Script', 'Segoe UI',
  'Skia', 'Snell Roundhand', 'Symbol', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Ubuntu', 'Verdana',
].sort();

const TEST_STRING = 'mmmmmmmmmmlli';
const TEST_SIZE = '72px';
const BASE_FONTS = ['monospace', 'sans-serif', 'serif'] as const;

export class FontCollector extends BaseCollector {
  readonly name = 'fonts';
  readonly stabilityClass = 'stable' as const;

  collect(): Promise<SignalRecord> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve({});

    // Measure baseline widths for each generic family
    const baseWidths: Record<string, number> = {};
    for (const base of BASE_FONTS) {
      ctx.font = `${TEST_SIZE} ${base}`;
      baseWidths[base] = ctx.measureText(TEST_STRING).width;
    }

    const detected: string[] = [];
    for (const font of FONTS) {
      for (const base of BASE_FONTS) {
        ctx.font = `${TEST_SIZE} '${font}', ${base}`;
        if (ctx.measureText(TEST_STRING).width !== baseWidths[base]) {
          detected.push(font);
          break;
        }
      }
    }

    return Promise.resolve({ 'fonts.list': detected.join(',') });
  }
}
