import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Deprecated fixed-URL feed endpoint. This route intentionally knows
 * nothing about any tenant, business, or catalogue source — it only
 * forwards to the per-source token URL (see ./[token]/route.ts) so an
 * already-configured external feed puller pointed at this fixed path
 * does not break while it is migrated to the new URL.
 *
 * LEGACY_META_FEED_TOKEN is set by operators, per environment, only for
 * the duration of that migration; once every external feed puller has
 * been repointed at /api/meta/catalog-feed/[token] directly, both the
 * env var and this route can be deleted.
 */
export async function GET(request: Request) {
  const token = process.env.LEGACY_META_FEED_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'This feed URL has moved. Use the per-source feed URL shown in Definições → Catálogo.' },
      { status: 404 },
    )
  }
  return NextResponse.redirect(new URL(`/api/meta/catalog-feed/${token}`, request.url), 308)
}
