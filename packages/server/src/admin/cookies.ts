import type { Request } from 'express';

// Whether auth cookies (session + CSRF) should carry the `Secure` attribute, decided
// per-request from the actual connection protocol rather than from NODE_ENV. A Secure
// cookie is only stored/returned by browsers over HTTPS — so keying it off the
// environment broke the plain-HTTP localhost dev stack (login set a Secure cookie the
// browser then withheld, failing the CSRF double-submit check).
//
// In the deploy/ topology Caddy terminates TLS and reverse-proxies plain HTTP to the
// server, so `req.secure` is false on that hop; we honour the `X-Forwarded-Proto` it
// sets. We read the header directly (as events.ts does for the client IP) instead of
// enabling Express `trust proxy`, to avoid changing `req.ip` semantics for the login
// throttle. This is safe for the Secure flag specifically: a spoofed `https` can only
// make a cookie *more* restrictive, never strip protection.
export function cookieSecure(req: Request): boolean {
  if (req.secure) return true;
  const xfProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  return proto?.split(',')[0]?.trim() === 'https';
}
