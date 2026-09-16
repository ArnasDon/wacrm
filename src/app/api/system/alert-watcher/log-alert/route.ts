import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { dispatchSystemAlert, resolveSystemAlert, type AlertSeverity } from '@/lib/observability/alerts'

/**
 * POST /api/system/alert-watcher/log-alert   { action?, severity, source, title, detail?, dedupKey, accountId?, throttleMinutes? }
 *
 * The ONLY way the "SANDIA alert watcher" cloud routine may write to
 * `system_alerts` — deliberately narrow, unlike its previous raw
 * Supabase access (a privileged, RLS-bypassing service-role connection
 * with zero table scoping — see the incident this endpoint exists to
 * prevent: 2026-09-15 21:04 UTC, a failed run fabricated two full fake
 * WhatsApp messages straight into `messages`, in two different
 * customer accounts, instead of logging its result here). This route
 * does exactly two things — `dispatchSystemAlert` or
 * `resolveSystemAlert`, the SAME internal functions every other alert
 * source in this app already uses — and nothing else is reachable
 * through it: no raw SQL, no arbitrary table, no cross-tenant write
 * surface beyond what `dedupKey`/`accountId` already mean for every
 * other caller of these two functions.
 *
 * Auth: shared secret via `x-watcher-secret` header, same pattern as
 * `AUTOMATION_CRON_SECRET` on the cron routes and this endpoint's own
 * sibling `../notify/route.ts`.
 */
export async function POST(request: Request) {
  const expected = process.env.ALERT_WATCHER_NOTIFY_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-watcher-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const dedupKey = typeof body.dedupKey === 'string' ? body.dedupKey.trim() : ''
  if (!dedupKey) {
    return NextResponse.json({ error: 'dedupKey is required' }, { status: 400 })
  }

  if (body.action === 'resolve') {
    await resolveSystemAlert(dedupKey)
    return NextResponse.json({ resolved: true })
  }

  const ALLOWED_SEVERITIES = new Set<AlertSeverity>(['info', 'warning', 'critical'])
  const severity = body.severity as AlertSeverity
  if (!ALLOWED_SEVERITIES.has(severity)) {
    return NextResponse.json({ error: 'severity must be info, warning, or critical' }, { status: 400 })
  }
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!source || !title) {
    return NextResponse.json({ error: 'source and title are required' }, { status: 400 })
  }
  const detail =
    body.detail && typeof body.detail === 'object' ? (body.detail as Record<string, unknown>) : undefined
  const accountId = typeof body.accountId === 'string' ? body.accountId : null
  const throttleMinutes =
    typeof body.throttleMinutes === 'number' && body.throttleMinutes > 0 ? body.throttleMinutes : undefined

  const result = await dispatchSystemAlert({
    severity,
    source,
    title,
    detail,
    dedupKey,
    accountId,
    throttleMinutes,
  })

  return NextResponse.json(result)
}
