import type { DmReferral } from '@/lib/messaging/dm-inbound'

/**
 * Best-effort ad / post referral extraction from a Zernio inbox webhook
 * payload. Zernio's public schema doesn't document a referral field
 * yet, so this probes every plausible location and returns null when
 * there's nothing — free when Zernio never forwards it, and it starts
 * capturing the moment they do (the caller also logs a hit so we
 * notice). Same `{ source, type, ad_id, ref }` shape Meta uses.
 */
export function extractZernioReferral(payload: unknown): DmReferral | null {
  const p = payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return null

  const get = (obj: unknown, ...path: string[]): unknown => {
    let cur: unknown = obj
    for (const key of path) {
      if (!cur || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
    return cur
  }

  const candidates: unknown[] = [
    get(p, 'message', 'referral'),
    get(p, 'message', 'metadata', 'referral'),
    get(p, 'message', 'metadata'),
    get(p, 'conversation', 'referral'),
    get(p, 'conversation', 'metadata', 'referral'),
    get(p, 'referral'),
  ]

  for (const c of candidates) {
    if (
      c &&
      typeof c === 'object' &&
      (('source' in c) || ('ad_id' in c) || ('ref' in c) || ('type' in c))
    ) {
      return c as DmReferral
    }
  }
  return null
}
