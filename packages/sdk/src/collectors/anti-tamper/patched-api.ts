import { BaseCollector } from '../base.js';
import type { SignalRecord } from '../types.js';

// Anti-fingerprinting tools commonly patch canvas and WebGL methods to return
// randomised or zeroed output. Patched functions lose the '[native code]' marker
// when inspected via Function.prototype.toString.
function isNative(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  const str = Function.prototype.toString.call(fn);
  return str.includes('[native code]');
}

export class PatchedApiCollector extends BaseCollector {
  readonly name = 'anti-tamper.patched-api';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    const canvasPatched = !isNative(HTMLCanvasElement.prototype.toDataURL);
    const getContextPatched = !isNative(HTMLCanvasElement.prototype.getContext);

    // WebGL parameter patching (common in LibreWolf, Brave with shields up)
    const webglCanvas = document.createElement('canvas');
    const gl = webglCanvas.getContext('webgl');
    const webglPatched = gl ? !isNative(gl.getParameter) : false;

    return Promise.resolve({
      'tamper.canvas_patched': canvasPatched,
      'tamper.get_context_patched': getContextPatched,
      'tamper.webgl_patched': webglPatched,
    });
  }
}
