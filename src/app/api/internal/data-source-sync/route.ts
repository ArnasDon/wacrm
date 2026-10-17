import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  DataSourceError,
  DataSourceNotFoundError,
  DataSourceRefreshInProgressError,
  refreshDataSource,
} from '@/lib/ai/data-sources/service'

/**
 * POST /api/internal/data-source-sync
 *
 * Lets an external trigger (today: a Google Apps Script bound to the
 * Sheet that Gmail-forwarded inventory emails already update) ask
 * WACRM to re-import ONE pre-configured, URL-based data source,
 * without a human session — same shared-secret pattern as
 * `/api/internal/heartbeat` and `/api/automations/cron`
 * (`timingSafeEqual`, dedicated env var, 401 on any mismatch, 503
 * until configured).
 *
 * Deliberately does NOT accept an account id, user id, or data
 * source id in the request body — those are never trustworthy from
 * an unauthenticated-until-proven-otherwise caller. The ONE source
 * this endpoint can ever touch is fixed by
 * `DATA_SOURCE_SYNC_SOURCE_ID` (an env var, not request input); its
 * `account_id` and `created_by` are looked up server-side from that
 * id, never supplied by the caller. This is the only data source
 * this endpoint can ever read or write — there is no path from an
 * authenticated request to any OTHER source, account, or user.
 *
 * Reuses `refreshDataSource()` unmodified — no parallel import/
 * persistence path. Every guarantee that function already has
 * (never deletes the previous generation of rows before a new one is
 * ready, never lets an HTML/empty response replace good data, H-5's
 * own per-source refresh lock) applies here exactly as it does to the
 * dashboard's manual "Refresh" button.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.DATA_SOURCE_SYNC_SECRET
  const sourceId = process.env.DATA_SOURCE_SYNC_SOURCE_ID
  if (!expectedSecret || !sourceId) {
    return NextResponse.json({ error: 'Data source sync is not configured.' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expectedSecret)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    // Never reveal whether the length or the content was wrong, and
    // never echo back anything the caller sent.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Keyed by the fixed source id, not by anything caller-supplied —
  // the caller has no identity of its own here beyond "knows the
  // secret," so there is nothing else meaningful to key on.
  const limit = checkRateLimit(`data-source-sync:${sourceId}`, RATE_LIMITS.dataSourceSync)
  if (!limit.success) return rateLimitResponse(limit)

  const admin = supabaseAdmin()
  const { data: configured, error: lookupError } = await admin
    .from('ai_data_sources')
    .select('id, account_id, created_by, source_type')
    .eq('id', sourceId)
    .maybeSingle()

  if (lookupError) {
    console.error('[data-source-sync] lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!configured) {
    // The configured id was deleted/never existed — a config problem
    // on our side, not the caller's; never a 401/404 that could be
    // confused with an auth or input mistake.
    return NextResponse.json(
      { error: 'The configured data source no longer exists.' },
      { status: 503 },
    )
  }
  // Only ever a URL-based source — an uploaded_csv has no URL to
  // refetch, and this endpoint never accepts a file body, so it could
  // never refresh one correctly even if misconfigured to point at one.
  if (configured.source_type !== 'google_sheets' && configured.source_type !== 'remote_csv') {
    return NextResponse.json(
      { error: 'The configured data source is not a URL-based source.' },
      { status: 503 },
    )
  }
  if (!configured.created_by) {
    // created_by is nullable only via ON DELETE SET NULL (the original
    // admin's account was removed) — refuse rather than inventing an
    // actor for ingestDocument()'s created_by trail.
    return NextResponse.json(
      {
        error:
          'The configured data source has no owning user. Refresh it once manually from Settings to restore one.',
      },
      { status: 503 },
    )
  }

  try {
    const { source, droppedColumns } = await refreshDataSource(admin, {
      accountId: configured.account_id as string,
      userId: configured.created_by as string,
      id: configured.id as string,
    })
    return NextResponse.json({
      success: true,
      data_source_id: source.id,
      row_count: source.row_count,
      last_synced_at: source.last_synced_at,
      ...(droppedColumns.length > 0 ? { dropped_columns: droppedColumns } : {}),
    })
  } catch (err) {
    if (err instanceof DataSourceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof DataSourceRefreshInProgressError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof DataSourceError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[data-source-sync] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
