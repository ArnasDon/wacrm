import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { deleteCatalogIntegration, saveCatalogIntegration } from '@/lib/ai/catalog/integrations'

/**
 * PATCH /api/integrations/catalog/[id]  (admin+)
 * Update display name / base URL / app key / scopes / primary flag, and
 * optionally ROTATE the secret (send `secret` only when rotating —
 * omitting it keeps the existing encrypted value untouched, same
 * "re-enter to change" contract as whatsapp_config's access token).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-integration-update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    // Every field below is passed only when present in the body — the
    // service layer treats an omitted key as "leave unchanged" (see
    // saveCatalogIntegration), so a PATCH that only rotates the secret
    // doesn't also blank out app_key or demote is_primary.
    const integration = await saveCatalogIntegration(supabase, accountId, userId, {
      id,
      provider: 'budun',
      displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
      baseUrl: typeof body.base_url === 'string' ? body.base_url : undefined,
      appKey: body.app_key !== undefined ? body.app_key : undefined,
      secret: typeof body.secret === 'string' && body.secret ? body.secret : undefined,
      scopes: Array.isArray(body.scopes) ? body.scopes : undefined,
      isPrimary: body.is_primary !== undefined ? Boolean(body.is_primary) : undefined,
      priority: body.priority,
    })
    return NextResponse.json({ success: true, integration })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/integrations/catalog/[id]  (admin+) — revoke/remove. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-integration-delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    await deleteCatalogIntegration(supabase, accountId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
