import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { OPENROUTER_BASE_URL } from '@/lib/ai/providers/openrouter'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'

/**
 * GET /api/ai/openrouter/models  (admin+)
 *
 * Model catalogue for the settings form's OpenRouter picker. OpenRouter
 * exposes hundreds of models behind one key and the ids are not
 * guessable (`vendor/model-id`), so the free-text Model field gets a
 * suggestion list instead of leaving admins to copy ids off the website.
 *
 * The upstream endpoint is public and unauthenticated — the account's
 * own key is never involved — but this handler is still admin-gated so
 * it can't be used as an open proxy, and the response is trimmed to the
 * two fields the picker renders.
 *
 * Best-effort by design: on any upstream failure it returns an empty
 * list with 200 so the form degrades to plain free text rather than
 * showing an error for a purely optional convenience.
 */

interface OpenRouterModel {
  id?: unknown
  name?: unknown
}

export interface OpenRouterModelOption {
  id: string
  name: string
}

/** Catalogue TTL. The list changes a few times a week at most, and it's
 *  shared by every admin on this instance, so one fetch per hour is
 *  plenty. Process-local (like the rate limiter) — a restart or a second
 *  instance just refetches. */
const CACHE_TTL_MS = 60 * 60 * 1000

let cache: { models: OpenRouterModelOption[]; fetchedAt: number } | null = null

async function fetchCatalogue(): Promise<OpenRouterModelOption[]> {
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    // Handled by the module-level TTL cache below, not Next's.
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`OpenRouter models responded ${res.status}`)

  const body = (await res.json()) as { data?: OpenRouterModel[] }
  const models = (Array.isArray(body?.data) ? body.data : [])
    .map((m): OpenRouterModelOption | null =>
      typeof m?.id === 'string' && m.id
        ? { id: m.id, name: typeof m.name === 'string' && m.name ? m.name : m.id }
        : null,
    )
    .filter((m): m is OpenRouterModelOption => m !== null)
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
}

export async function GET() {
  try {
    await requireRole('admin')

    const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS
    if (!fresh) {
      try {
        cache = { models: await fetchCatalogue(), fetchedAt: Date.now() }
      } catch (err) {
        console.error('[ai/openrouter/models] fetch failed:', err)
        // Serve a stale list if we have one — a day-old catalogue beats
        // no suggestions at all.
        if (!cache) return NextResponse.json({ models: [] })
      }
    }

    return NextResponse.json({ models: cache?.models ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
