import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getBusinessProfile, upsertBusinessProfile, listDepartments, listContacts } from '@/lib/ai/business-profile/service'
import type { BusinessProfileInput, BusinessHours, BusinessLink, BusinessFaqItem } from '@/lib/ai/business-profile/types'

/**
 * GET /api/ai/business-profile  (viewer+)
 *
 * Settings → AI Assistant → Business Profile. Returns the account's one
 * profile row (or null if never configured — a normal state, not an
 * error) plus every department/contact (active AND inactive, so the
 * admin can re-enable one) so the whole section renders from one call.
 * This is the ADMIN-facing shape — the agent-facing loader
 * (loadBusinessProfileForAgent, active-only) is a separate function in
 * the service layer, never this route.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const [profile, departments, contacts] = await Promise.all([
      getBusinessProfile(supabase, accountId),
      listDepartments(supabase, accountId),
      listContacts(supabase, accountId),
    ])
    return NextResponse.json({ profile, departments, contacts })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function readString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined
  const v = body[key]
  if (v === null) return null
  return typeof v === 'string' ? v : undefined
}

function readStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  if (!(key in body)) return undefined
  return Array.isArray(body[key]) ? body[key].filter((v): v is string => typeof v === 'string') : undefined
}

/**
 * PUT /api/ai/business-profile  (admin+)
 *
 * Create-or-update the account's ONE Business Profile row. Every field
 * is optional — only keys actually present in the body are written
 * (see upsertBusinessProfile's partial-update contract), so a save from
 * one Settings tab (e.g. just hours) never blanks out the rest. This is
 * the ONLY way the profile is ever written — the agent never gets a
 * tool to modify it (FASE 6, Parte 19: read-only to the agent).
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const input: BusinessProfileInput = {
      businessName: readString(body, 'business_name'),
      description: readString(body, 'description'),
      phone: readString(body, 'phone'),
      whatsapp: readString(body, 'whatsapp'),
      email: readString(body, 'email'),
      website: readString(body, 'website'),
      address: readString(body, 'address'),
      city: readString(body, 'city'),
      state: readString(body, 'state'),
      country: readString(body, 'country'),
      googleMapsUrl: readString(body, 'google_maps_url'),
      businessHours:
        'business_hours' in body && body.business_hours && typeof body.business_hours === 'object'
          ? (body.business_hours as BusinessHours)
          : undefined,
      deliveryEnabled: typeof body.delivery_enabled === 'boolean' ? body.delivery_enabled : undefined,
      deliveryDescription: readString(body, 'delivery_description'),
      deliveryCoverageAreas: readStringArray(body, 'delivery_coverage_areas'),
      paymentMethods: readStringArray(body, 'payment_methods'),
      warrantyPolicy: readString(body, 'warranty_policy'),
      returnPolicy: readString(body, 'return_policy'),
      financingPolicy: readString(body, 'financing_policy'),
      deliveryPolicy: readString(body, 'delivery_policy'),
      links: Array.isArray(body.links) ? (body.links as BusinessLink[]) : undefined,
      faq: Array.isArray(body.faq) ? (body.faq as BusinessFaqItem[]) : undefined,
    }
    // Strip undefined keys so they're genuinely absent (not "set to
    // undefined") — matters because upsertBusinessProfile's inputToRow
    // checks `!== undefined` to decide what to write.
    for (const key of Object.keys(input) as (keyof BusinessProfileInput)[]) {
      if (input[key] === undefined) delete input[key]
    }

    const profile = await upsertBusinessProfile(supabase, accountId, userId, input)
    return NextResponse.json({ success: true, profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}
