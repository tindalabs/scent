import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}

export class CanvasCollector extends BaseCollector {
  readonly name = 'canvas';
  readonly stabilityClass = 'stable' as const;

  collect(): Promise<SignalRecord> {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve({});

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.font = "14px 'Arial'";
    ctx.fillText('Scent 🍃 1.0', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('Scent 🍃 1.0', 4, 17);

    const hash2d = djb2(canvas.toDataURL());

    // WebGL renderer string — GPU-level signal, very stable
    const glCanvas = document.createElement('canvas');
    const gl =
      glCanvas.getContext('webgl') ??
      (glCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    let glHash = '';
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
        const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
        glHash = djb2(`${vendor}|${renderer}`);
      }
    }

    return Promise.resolve({
      'canvas.2d': hash2d,
      ...(glHash ? { 'canvas.webgl': glHash } : {}),
    });
  }
}
