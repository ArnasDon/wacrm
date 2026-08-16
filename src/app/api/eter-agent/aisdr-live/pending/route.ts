import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { fetchPendingApprovals, AiSdrWorkerError } from '@/lib/eter/aisdr-live-client'

// ============================================================
// GET /api/eter-agent/aisdr-live/pending  (admin+)
//
// Internal proxy for the AI SDR worker's GET /api/approvals/pending —
// powers the "SDR ao vivo" dashboard page
// (src/app/(dashboard)/sdr-ao-vivo/page.tsx).
//
// SECURITY: this is the only place `APPROVALS_CALLBACK_SECRET` is used
// for this feature (via aisdr-live-client.ts), and it never leaves the
// server. The browser only ever talks to this route, authenticated by
// the normal Supabase session cookie + `requireRole('admin')` — the
// AI SDR worker's own secret is never sent to, or returned to, the
// client. See aisdr-live-client.test.ts and this route's own test for
// the assertion that no response body can ever contain the secret.
// ============================================================

const MAX_LIMIT = 50

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export async function GET(request: Request) {
  try {
    await requireRole('admin')

    const { searchParams } = new URL(request.url)
    const limit = clampInt(searchParams.get('limit'), 20, 1, MAX_LIMIT)
    const offset = clampInt(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

    const data = await fetchPendingApprovals({ limit, offset })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof AiSdrWorkerError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502
      return NextResponse.json({ error: err.message }, { status })
    }
    return toErrorResponse(err)
  }
}
