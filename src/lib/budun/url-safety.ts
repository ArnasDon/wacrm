// ============================================================
// SSRF guard for the Budun ERP integration (security audit finding
// IC-A1 — "Integraciones / Configuración Externa").
//
// `catalog_integrations.base_url` is admin-configurable per account and
// `BudunClient` makes a REAL outbound request to it from our server —
// the same SSRF primitive already solved for outbound webhooks
// (`@/lib/webhooks/ssrf`, `isDeliverableUrl`) and for `ai_data_sources`
// remote URLs (`assertSafeUrl` in `@/lib/ai/data-sources/service.ts`).
// `base_url` was the one URL of this shape in the codebase with no
// guard at all — this module closes that gap.
//
// Deliberately REUSES `isDeliverableUrl` for the IP/hostname
// classification (loopback, RFC1918, link-local, cloud metadata, IPv6
// ULA/link-local, IPv4-mapped IPv6) rather than adding a third parallel
// implementation of the same private/reserved-range logic. This module
// only adds the piece `isDeliverableUrl` intentionally leaves out for
// its own callers: an explicit scheme allowlist (Budun ERP is always
// plain HTTP(S), never a webhook-style "any scheme the receiver wants"
// contract).
//
// Checked at TWO points, both required (neither replaces the other):
//   1. Persistence time — `saveCatalogIntegration()` in
//      `@/lib/ai/catalog/integrations.ts` — refuses to save a
//      dangerous `base_url` in the first place.
//   2. Runtime, immediately before every `fetch()` inside
//      `BudunClient.get()` — catches a row saved before this guard
//      existed, or a hostname whose DNS record changed after saving.
//      Re-checking right before connecting narrows, but — per
//      `isDeliverableUrl`'s own documented limits — does not fully
//      eliminate, DNS-rebinding (a name that resolves public at check
//      time and private at connect time). Fully closing that would
//      require pinning the exact validated IP into the socket, which
//      the standard `fetch()` API does not expose; this is the same
//      accepted trade-off already made by `@/lib/webhooks/ssrf` and
//      `@/lib/ai/data-sources/service.ts` elsewhere in this codebase,
//      so this guard stays consistent with the established convention
//      rather than depending on an unrelated low-level HTTP client.
// ============================================================

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

/**
 * True only for an `http:`/`https:` URL whose hostname resolves
 * exclusively to publicly-routable addresses. Rejects malformed URLs,
 * every other scheme (`file:`, `ftp:`, `data:`, ...), and any
 * loopback/RFC1918/link-local/ULA/reserved address — the IP/hostname
 * classification itself is delegated to `isDeliverableUrl`.
 */
export async function isSafeBudunUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }
  return isDeliverableUrl(rawUrl)
}
