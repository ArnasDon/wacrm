import { describe, it, expect, vi, beforeEach } from 'vitest'

// `isSafeBudunUrl` delegates hostname resolution to `isDeliverableUrl`
// (`@/lib/webhooks/ssrf`), which calls `node:dns/promises`'s `lookup`.
// Mocking it here lets the "hostname resolves to a private IP" cases
// run deterministically and offline — literal-IP cases below never
// reach this mock at all (`isDeliverableUrl` short-circuits on `isIP`).
const dnsMocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dnsMocks.lookup }))

import { isSafeBudunUrl } from './url-safety'

beforeEach(() => {
  dnsMocks.lookup.mockReset()
})

describe('isSafeBudunUrl — scheme', () => {
  it('allows a public https:// URL', async () => {
    expect(await isSafeBudunUrl('https://8.8.8.8')).toBe(true)
  })

  it('allows a public http:// URL', async () => {
    expect(await isSafeBudunUrl('http://8.8.8.8')).toBe(true)
  })

  it('rejects a non-http(s) scheme', async () => {
    expect(await isSafeBudunUrl('ftp://8.8.8.8')).toBe(false)
    expect(await isSafeBudunUrl('file:///etc/passwd')).toBe(false)
    expect(await isSafeBudunUrl('data:text/plain,hi')).toBe(false)
  })

  it('rejects a malformed URL', async () => {
    expect(await isSafeBudunUrl('not a url')).toBe(false)
  })
})

describe('isSafeBudunUrl — literal IPs (no DNS involved)', () => {
  it('rejects localhost', async () => {
    expect(await isSafeBudunUrl('https://localhost')).toBe(false)
  })

  it('rejects loopback (127.0.0.0/8)', async () => {
    expect(await isSafeBudunUrl('https://127.0.0.1')).toBe(false)
  })

  it('rejects IPv6 loopback (::1)', async () => {
    expect(await isSafeBudunUrl('https://[::1]')).toBe(false)
  })

  it('rejects RFC1918 10.0.0.0/8', async () => {
    expect(await isSafeBudunUrl('https://10.0.0.5')).toBe(false)
  })

  it('rejects RFC1918 172.16.0.0/12', async () => {
    expect(await isSafeBudunUrl('https://172.16.0.1')).toBe(false)
    expect(await isSafeBudunUrl('https://172.31.255.255')).toBe(false)
  })

  it('rejects RFC1918 192.168.0.0/16', async () => {
    expect(await isSafeBudunUrl('https://192.168.1.1')).toBe(false)
  })

  it('rejects link-local / cloud metadata (169.254.0.0/16)', async () => {
    expect(await isSafeBudunUrl('https://169.254.169.254')).toBe(false)
  })

  it('rejects IPv6 link-local (fe80::/10)', async () => {
    expect(await isSafeBudunUrl('https://[fe80::1]')).toBe(false)
  })

  it('rejects IPv6 ULA (fc00::/7)', async () => {
    expect(await isSafeBudunUrl('https://[fc00::1]')).toBe(false)
    expect(await isSafeBudunUrl('https://[fd12::34]')).toBe(false)
  })

  it('allows a literal public IPv4', async () => {
    expect(await isSafeBudunUrl('https://93.184.216.34')).toBe(true)
  })

  it('allows a literal public IPv6', async () => {
    expect(await isSafeBudunUrl('https://[2606:4700:4700::1111]')).toBe(true)
  })
})

describe('isSafeBudunUrl — hostname resolution (DNS mocked)', () => {
  it('allows a hostname that resolves only to public addresses', async () => {
    dnsMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await isSafeBudunUrl('https://erp.example.com')).toBe(true)
  })

  it('rejects a hostname that resolves to a private address', async () => {
    dnsMocks.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    expect(await isSafeBudunUrl('https://internal.example.com')).toBe(false)
  })

  it('rejects a hostname with multiple resolved addresses where ANY one is private', async () => {
    dnsMocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ])
    expect(await isSafeBudunUrl('https://multi.example.com')).toBe(false)
  })

  it('rejects a hostname that fails to resolve', async () => {
    dnsMocks.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await isSafeBudunUrl('https://does-not-resolve.example.com')).toBe(false)
  })
})
