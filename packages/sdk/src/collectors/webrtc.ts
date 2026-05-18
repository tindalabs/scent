import { BaseCollector } from './base.js';
import type { SignalRecord } from './types.js';

// RFC-1918 + loopback + link-local ranges
function isPrivateIP(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('192.168.')) return true;
  const parts = ip.split('.');
  if (parts.length === 4) {
    const second = parseInt(parts[1]!, 10);
    if (parts[0] === '172' && second >= 16 && second <= 31) return true;
  }
  // IPv6 link-local
  if (ip.toLowerCase().startsWith('fe80:')) return true;
  return false;
}

function extractIP(candidate: string): string | null {
  // IPv4
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(candidate);
  if (v4) return v4[1]!;
  // IPv6 (non-link-local, omit mDNS .local hostnames)
  const v6 = /([0-9a-fA-F:]{4,}:[0-9a-fA-F:]{0,4})/.exec(candidate);
  if (v6 && !candidate.includes('.local')) return v6[1]!;
  return null;
}

export class WebRTCCollector extends BaseCollector {
  readonly name = 'webrtc';
  readonly stabilityClass = 'volatile' as const;

  collect(): Promise<SignalRecord> {
    if (typeof RTCPeerConnection === 'undefined') return Promise.resolve({});

    return new Promise((resolve) => {
      const ips = new Set<string>();
      let pc: RTCPeerConnection | null = null;

      const finish = () => {
        try { pc?.close(); } catch { /* ignore */ }
        if (ips.size === 0) { resolve({}); return; }

        const all = Array.from(ips).sort();
        const publicIps = all.filter((ip) => !isPrivateIP(ip));
        const result: SignalRecord = { 'webrtc.local_ips': all.join(',') };
        if (publicIps[0]) result['webrtc.public_ip'] = publicIps[0];
        resolve(result);
      };

      const timeout = setTimeout(finish, 2000);

      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.createDataChannel('');

        pc.onicecandidate = (event) => {
          if (!event.candidate) {
            clearTimeout(timeout);
            finish();
            return;
          }
          const ip = extractIP(event.candidate.candidate);
          if (ip) ips.add(ip);
        };

        pc.createOffer()
          .then((offer) => pc!.setLocalDescription(offer))
          .catch(() => { clearTimeout(timeout); finish(); });
      } catch {
        clearTimeout(timeout);
        resolve({});
      }
    });
  }
}
