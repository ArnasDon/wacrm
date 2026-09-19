import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// ============================================================
// SSRF-safe outbound fetch for URLs that come from USERS (automation
// webhooks, custom AI provider base URLs).
//
// Fixes GHSA-8jqh-598v-rfxc's class of bug:
//   - http/https only;
//   - the hostname is resolved and EVERY resolved address is checked
//     against private / loopback / link-local / metadata ranges (so a
//     public name pointing at 169.254.169.254 is refused too);
//   - redirects are NOT followed (a 302 to an internal host would
//     otherwise bypass the check);
//   - hard timeout and response-size cap;
//   - caller-supplied headers are filtered through an allowlist of
//     names — no Host / Cookie / hop-by-hop injection.
//
// Residual risk: DNS rebinding between our lookup and fetch's own
// lookup. The window is milliseconds; for a hard guarantee put
// outbound traffic through an egress proxy.
// ============================================================

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return BLOCKED_V4.some(([base, bits]) => inCidr4(ip, base, bits))
  if (version === 6) {
    const v = ip.toLowerCase()
    if (v === '::' || v === '::1') return true
    // IPv4-mapped (::ffff:10.0.0.1) — check the embedded v4.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    if (v.startsWith('fc') || v.startsWith('fd')) return true // unique local
    if (/^fe[89ab]/.test(v)) return true // link-local
    if (v.startsWith('ff')) return true // multicast
    return false
  }
  return true // not an IP at all → refuse
}

/** Validate a user-supplied URL, resolving DNS. Throws UnsafeUrlError. */
export async function assertPublicUrl(
  raw: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('Not a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError('Only http and https URLs are allowed')
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed')
  }
  if (opts.allowPrivate) return url

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new UnsafeUrlError('Hostname does not resolve')
      })
  if (addrs.length === 0) throw new UnsafeUrlError('Hostname does not resolve')
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new UnsafeUrlError('URL points to a private or internal network address')
    }
  }
  return url
}

const ALLOWED_HEADER = /^(content-type|accept|authorization|x-api-key|api-key|anthropic-version|x-[a-z0-9-]{1,40})$/i
const FORBIDDEN_HEADERS = new Set(['x-forwarded-for', 'x-forwarded-host', 'x-real-ip'])

export function filterHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== 'string' || v.length > 4000) continue
    if (!ALLOWED_HEADER.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase())) continue
    if (/[\r\n]/.test(v)) continue
    out[k] = v
  }
  return out
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxResponseBytes?: number
  allowPrivate?: boolean
}

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ status: number; ok: boolean; text: string }> {
  const url = await assertPublicUrl(rawUrl, { allowPrivate: opts.allowPrivate })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: opts.headers,
      body: opts.body,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (res.status >= 300 && res.status < 400) {
      throw new UnsafeUrlError('Redirects are not followed')
    }
    const max = opts.maxResponseBytes ?? 2 * 1024 * 1024
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > max) {
          controller.abort()
          throw new UnsafeUrlError('Response too large')
        }
        chunks.push(value)
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks))
    return { status: res.status, ok: res.ok, text }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new UnsafeUrlError('Request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
