// ============================================================
// SSRF guard for outbound webhook delivery.
//
// A webhook URL is attacker-influenced (any account admin with
// `webhooks:manage` can register one) and our server makes the request,
// so an unguarded fetch is a Server-Side Request Forgery primitive: a
// URL pointing at `127.0.0.1`, a cloud metadata IP (`169.254.169.254`),
// or an RFC1918 host would let a caller probe / POST to internal
// services from the app's network.
//
// `isDeliverableUrl` resolves the host and rejects any address that is
// loopback, private, link-local, ULA, or otherwise non-publicly-
// routable. Combined with `redirect: 'manual'` at the call site (so a
// public URL can't 3xx-bounce to an internal one), this blocks the
// common SSRF vectors. It is NOT a defense against DNS rebinding (a
// host that resolves public here but flips to private before connect) —
// that needs pinning the resolved IP into the socket, which fetch
// doesn't expose; documented as a residual risk.
// ============================================================

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for loopback / private / link-local / reserved IPv4 or IPv6. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1' || v6 === '::') return true; // loopback / unspecified
  if (
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb')
  )
    return true; // fe80::/10 link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7 ULA
  const mapped = v6.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateOrReservedIp(mapped[1]); // IPv4-mapped
  return false;
}

/**
 * True if `rawUrl`'s host resolves only to publicly-routable
 * address(es). Returns false for a malformed URL, an obvious internal
 * name (`localhost`, `*.local`, `*.internal`), a literal private IP, or
 * a hostname that resolves to any private/reserved address.
 */
export async function isDeliverableUrl(rawUrl: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }

  if (isIP(host)) return !isPrivateOrReservedIp(host);

  const lower = host.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return false;
  }

  try {
    const results = await lookup(host, { all: true });
    if (results.length === 0) return false;
    return results.every((r) => !isPrivateOrReservedIp(r.address));
  } catch {
    return false; // unresolvable → not deliverable
  }
}
