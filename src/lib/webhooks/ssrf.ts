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

// ------------------------------------------------------------
// IP classification
//
// Both halves parse the address into its raw octets before deciding
// anything. That matters more than it looks: the previous string-prefix
// implementation was bypassed twice over, because the same address has
// many spellings and only some of them look private.
//
//   - GHSA-m4cp-pqxq-x9f7: `https://[::ffff:127.0.0.1]/` is normalized
//     by the WHATWG URL parser to `[::ffff:7f00:1]`, so a regex looking
//     for a dotted-decimal suffix never fired.
//   - GHSA-q4p6-pj4g-26xx: 6to4 (`2002::/16`), NAT64 (`64:ff9b::/32`)
//     and Teredo (`2001::/32`) all carry an IPv4 address inside an
//     otherwise ordinary-looking global-unicast prefix, so
//     `2002:a9fe:a9fe::` routed to `169.254.169.254`.
//
// Working from octets, an IPv4-mapped address is the same 4 bytes
// however it was written, and the transition prefixes are a byte
// comparison. Anything that fails to parse is treated as reserved:
// this guard is an allowlist of publicly-routable space, so "I don't
// recognise this" has to mean "don't deliver".
// ------------------------------------------------------------

/** The four octets of a strict dotted-quad IPv4 literal, else null. */
function parseIPv4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/**
 * True for any IPv4 address outside global unicast — RFC 6890
 * special-purpose space, not just the three RFC 1918 ranges.
 */
function isReservedIPv4([a, b, c]: number[]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + broadcast
  return false;
}

/**
 * Expand an IPv6 literal to its 16 octets, else null.
 *
 * Handles `::` compression, a trailing dotted-quad (`::ffff:1.2.3.4`)
 * and a scope/zone id (`fe80::1%eth0`) — the zone is dropped, the
 * address bytes are what get classified.
 */
function parseIPv6(ip: string): number[] | null {
  const addr = ip.split('%')[0];
  if (addr.length === 0) return null;

  const halves = addr.split('::');
  if (halves.length > 2) return null; // "::" may appear at most once

  const groupsOf = (part: string): number[][] | null => {
    if (part === '') return [];
    const out: number[][] = [];
    const chunks = part.split(':');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // A dotted-quad tail occupies the last two groups.
      if (i === chunks.length - 1 && chunk.includes('.')) {
        const v4 = parseIPv4(chunk);
        if (!v4) return null;
        out.push([v4[0], v4[1]], [v4[2], v4[3]]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(chunk)) return null;
      const n = parseInt(chunk, 16);
      out.push([n >> 8, n & 0xff]);
    }
    return out;
  };

  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.flat();
  }
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null; // "::" must stand for at least one group
  return [...head.flat(), ...new Array(fill * 2).fill(0), ...tail.flat()];
}

/** True for any IPv6 address outside global unicast. */
function isReservedIPv6(b: number[]): boolean {
  const zerosThrough = (n: number) => b.slice(0, n).every((x) => x === 0);

  // ::/128 unspecified and ::1/128 loopback.
  if (zerosThrough(15) && b[15] <= 1) return true;

  // IPv4-mapped ::ffff:0:0/96 — classify the address it actually names.
  if (zerosThrough(10) && b[10] === 0xff && b[11] === 0xff) {
    return isReservedIPv4(b.slice(12));
  }

  // The rest of ::/96 is IPv4-compatible (deprecated) plus reserved
  // space; nothing in it is a routable webhook target.
  if (zerosThrough(12)) return true;

  // NAT64 64:ff9b::/32 — covers the well-known /96 prefix and the
  // local-use 64:ff9b:1::/48. RFC 6052 allows the embedded IPv4 at
  // several offsets, so block the whole prefix rather than guessing
  // which one is in play.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return true;
  }

  // 6to4 2002::/16 — the embedded IPv4 is bits 16..47, and that is the
  // address the packet ends up at.
  if (b[0] === 0x20 && b[1] === 0x02) {
    return isReservedIPv4(b.slice(2, 6));
  }

  if (b[0] === 0x20 && b[1] === 0x01) {
    // Teredo 2001::/32 always embeds a client IPv4 (bit-inverted) and
    // is deprecated; block the prefix outright.
    if (b[2] === 0x00 && b[3] === 0x00) return true;
    // ORCHID 2001:10::/28 and 2001:20::/28 — non-routed identifiers.
    if (b[2] === 0x00 && ((b[3] & 0xf0) === 0x10 || (b[3] & 0xf0) === 0x20)) {
      return true;
    }
    // 2001:db8::/32 documentation.
    if (b[2] === 0x0d && b[3] === 0xb8) return true;
  }

  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  // 100::/64 discard-only.
  if (b[0] === 0x01 && b.slice(1, 8).every((x) => x === 0)) return true;

  return false;
}

/**
 * True for loopback / private / link-local / reserved IPv4 or IPv6,
 * including the IPv6 transition encodings that embed such an IPv4.
 *
 * Fails closed: an address this can't parse is reported as reserved.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const bare = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  const v4 = parseIPv4(bare);
  if (v4) return isReservedIPv4(v4);

  const v6 = parseIPv6(bare);
  if (v6) return isReservedIPv6(v6);

  return true; // unparseable → not demonstrably public
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
