import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { DataSourceError, refreshDataSource } from '@/lib/ai/data-sources/service'

/**
 * POST /api/ai/data-sources/[id]/refresh  (admin+)
 *
 * Re-fetches (google_sheets/remote_csv) or re-parses an uploaded file
 * (uploaded_csv — send a fresh `file` as multipart/form-data; there is
 * no stored URL to refetch) and replaces this source's own KB
 * document/catalog rows, leaving every other source and the legacy
 * singleton inventory document untouched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-data-source-refresh:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params

    let file: { filename: string; buffer: ArrayBuffer } | undefined
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null)
      const uploaded = formData?.get('file')
      if (uploaded instanceof File) {
        file = { filename: uploaded.name, buffer: await uploaded.arrayBuffer() }
      }
    }

    const { source, droppedColumns } = await refreshDataSource(supabase, { accountId, userId, id, file })
    return NextResponse.json({
      success: true,
      data_source: source,
      // Non-fatal — the refresh already succeeded above. Lets the UI
      // warn "la columna X ya no existe en tu hoja" without treating
      // it as a sync failure (point 17).
      ...(droppedColumns.length > 0 ? { dropped_columns: droppedColumns } : {}),
    })
  } catch (err) {
    if (err instanceof DataSourceError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    return toErrorResponse(err)
  }
}
