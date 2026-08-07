import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getCalendarConfig, upsertCalendarConfig } from '@/lib/eter/repo/calendar-config.repo'
import { validateBusinessHours, BusinessHoursError } from '@/lib/calendar/business-hours'
import type { CalendarConfig } from '@/lib/eter/repo/calendar-config.repo'

// ============================================================
// GET/PATCH /api/calendar/config
//
// Read/update the account's calendar settings (which calendar,
// timezone, business hours, booking durations/buffers, active
// switch). Deliberately does NOT accept or return `refreshToken` —
// that's write-only via the OAuth callback
// (`/api/calendar/google/callback`); this route only ever reads it
// internally (to satisfy `upsertCalendarConfig`'s full-replace
// contract) and never puts it on the wire.
// ============================================================

/** Client-facing shape — `refreshToken` and internal `id` excluded. */
function toPublicConfig(config: CalendarConfig) {
  return {
    connected: true as const,
    calendarId: config.calendarId,
    timezone: config.timezone,
    businessHours: config.businessHours,
    defaultDurationMin: config.defaultDurationMin,
    bufferMin: config.bufferMin,
    minLeadTimeMin: config.minLeadTimeMin,
    isActive: config.isActive,
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const config = await getCalendarConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json({ connected: false })
    }
    return NextResponse.json(toPublicConfig(config))
  } catch (err) {
    return toErrorResponse(err)
  }
}

interface PatchBody {
  calendarId?: unknown
  timezone?: unknown
  businessHours?: unknown
  defaultDurationMin?: unknown
  bufferMin?: unknown
  minLeadTimeMin?: unknown
  isActive?: unknown
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const existing = await getCalendarConfig(supabase, accountId)
    if (!existing) {
      return NextResponse.json(
        {
          error:
            'No Google Calendar connection yet — use "Connect Google Calendar" before configuring settings.',
        },
        { status: 409 },
      )
    }

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if ('calendarId' in body && (typeof body.calendarId !== 'string' || !body.calendarId.trim())) {
      return NextResponse.json({ error: 'calendarId must be a non-empty string.' }, { status: 400 })
    }
    if ('timezone' in body && (typeof body.timezone !== 'string' || !body.timezone.trim())) {
      return NextResponse.json({ error: 'timezone must be a non-empty IANA timezone string.' }, { status: 400 })
    }
    if ('isActive' in body && typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be a boolean.' }, { status: 400 })
    }
    for (const field of ['defaultDurationMin', 'bufferMin', 'minLeadTimeMin'] as const) {
      if (field in body && !isNonNegativeInt(body[field])) {
        return NextResponse.json({ error: `${field} must be a non-negative integer.` }, { status: 400 })
      }
    }

    let businessHours = existing.businessHours
    if ('businessHours' in body) {
      try {
        businessHours = validateBusinessHours(body.businessHours)
      } catch (err) {
        if (err instanceof BusinessHoursError) {
          return NextResponse.json({ error: err.message }, { status: 400 })
        }
        throw err
      }
    }

    const updated = await upsertCalendarConfig(supabase, accountId, {
      // Never accepted from the client — reuse the already-connected
      // token so this route can never rotate/clear it.
      refreshToken: existing.refreshToken,
      calendarId: typeof body.calendarId === 'string' ? body.calendarId.trim() : existing.calendarId,
      timezone: typeof body.timezone === 'string' ? body.timezone.trim() : existing.timezone,
      businessHours,
      defaultDurationMin:
        typeof body.defaultDurationMin === 'number' ? body.defaultDurationMin : existing.defaultDurationMin,
      bufferMin: typeof body.bufferMin === 'number' ? body.bufferMin : existing.bufferMin,
      minLeadTimeMin: typeof body.minLeadTimeMin === 'number' ? body.minLeadTimeMin : existing.minLeadTimeMin,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : existing.isActive,
    })

    return NextResponse.json(toPublicConfig(updated))
  } catch (err) {
    return toErrorResponse(err)
  }
}
