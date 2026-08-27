import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { listCatalogIntegrations, saveCatalogIntegration } from '@/lib/ai/catalog/integrations'

/**
 * GET /api/integrations/catalog  (viewer+)
 * Settings → Integrations → Inventory API. Lists every configured
 * Catalog API integration for the account (Budun ERP today; the
 * `provider` field is what future ERPs would vary). Never returns the
 * secret — only PUBLIC_COLUMNS.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const integrations = await listCatalogIntegrations(supabase, accountId)
    return NextResponse.json({ integrations })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/integrations/catalog  (admin+)
 * Creates a new Catalog API integration. `secret` is required on
 * create, encrypted server-side (AES-256-GCM, same as whatsapp_config)
 * before it touches the database, and never echoed back.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-integration-create:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const { provider, display_name, base_url, app_key, secret, scopes, is_primary } = body

    if (provider !== 'budun') {
      return NextResponse.json({ error: 'provider must be "budun".' }, { status: 400 })
    }
    if (!display_name || typeof display_name !== 'string') {
      return NextResponse.json({ error: 'display_name is required.' }, { status: 400 })
    }
    if (!base_url || typeof base_url !== 'string') {
      return NextResponse.json({ error: 'base_url is required.' }, { status: 400 })
    }
    if (!secret || typeof secret !== 'string') {
      return NextResponse.json({ error: 'secret is required.' }, { status: 400 })
    }

    const integration = await saveCatalogIntegration(supabase, accountId, userId, {
      provider,
      displayName: display_name,
      baseUrl: base_url,
      appKey: app_key ?? null,
      secret,
      scopes: Array.isArray(scopes) ? scopes : undefined,
      isPrimary: Boolean(is_primary),
    })
    return NextResponse.json({ success: true, integration })
  } catch (err) {
    return toErrorResponse(err)
  }
}
