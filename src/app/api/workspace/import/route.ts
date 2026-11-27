import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BUNDLE_SECTIONS, parseBundle, summarizeBundle, type BundleSection } from '@/lib/bundle/schema'
import { importBundle, type SubmitTemplateFn } from '@/lib/bundle/import-server'
import { POST as submitTemplateRoute } from '@/app/api/whatsapp/templates/submit/route'

/**
 * POST /api/workspace/import  (admin+)
 *
 * Body: `{ "bundle": { ... }, "sections": ["flows", ...], "dry_run": false }`
 * (or the bundle itself). `sections` defaults to everything in the
 * bundle. `dry_run` only validates and returns the summary.
 *
 * Message templates go through the existing submit route (same
 * validation, same Meta submission, same local upsert) so nothing about
 * template handling is duplicated here.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`workspace-import:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const looksWrapped = body && typeof body === 'object' && 'bundle' in body
    const parsed = parseBundle(looksWrapped ? body.bundle : body)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Invalid bundle file.', details: parsed.errors },
        { status: 400 },
      )
    }

    const requested = looksWrapped && Array.isArray(body.sections) ? body.sections : null
    const sections = (requested ?? [...BUNDLE_SECTIONS]).filter((s): s is BundleSection =>
      (BUNDLE_SECTIONS as readonly string[]).includes(s as string),
    )
    const summary = summarizeBundle(parsed.bundle)
    if (looksWrapped && body.dry_run === true) {
      return NextResponse.json({ dry_run: true, summary })
    }

    const submitTemplate: SubmitTemplateFn = async (payload) => {
      const res = await submitTemplateRoute(
        new Request('http://internal/api/whatsapp/templates/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
      if (res.ok) return { ok: true }
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: j.error }
    }

    const results = await importBundle(
      { supabase: ctx.supabase, accountId: ctx.accountId, userId: ctx.userId },
      parsed.bundle,
      { sections, submitTemplate },
    )
    return NextResponse.json({ success: true, summary, results })
  } catch (err) {
    return toErrorResponse(err)
  }
}
