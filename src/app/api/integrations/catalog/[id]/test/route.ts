import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { testCatalogIntegration } from '@/lib/ai/catalog/integrations'

/**
 * POST /api/integrations/catalog/[id]/test  (admin+)
 *
 * "Probar conexión" per
 * docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
 * §21: decrypts the stored secret server-side, makes one cheap live
 * Catalog API call, and persists last_test_at/last_test_ok/last_error.
 * Always 200s with a structured result (mirrors GET /api/whatsapp/
 * config) — never leaks the secret in the message.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-integration-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const result = await testCatalogIntegration(supabase, accountId, id)
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
