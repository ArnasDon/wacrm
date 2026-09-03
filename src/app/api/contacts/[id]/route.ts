import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import type { LeadTemperature } from '@/types'

const LEAD_TEMPERATURES = new Set<LeadTemperature>(['cold', 'warm', 'hot'])

/**
 * PATCH /api/contacts/[id]
 *
 * Updates a contact — the server-side counterpart to the dashboard
 * edit form (src/components/contacts/contact-form.tsx) and the
 * Contact detail panel's inline temperature editor
 * (src/components/contacts/contact-detail-view.tsx), both of which
 * used to write directly to Supabase from the browser. Moved
 * server-side so an edit that changes `lead_temperature` fires
 * `contact.lead_temperature_changed`.
 *
 * Body: any of { name, phone, email, company, lead_temperature }
 * (all optional — only present fields are written).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('contacts')
      .select('id, lead_temperature')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) updates.name = typeof body.name === 'string' ? body.name.trim() || null : null
    if ('phone' in body) {
      const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
      if (!phone) return NextResponse.json({ error: 'phone cannot be empty' }, { status: 400 })
      updates.phone = phone
    }
    if ('email' in body) updates.email = typeof body.email === 'string' ? body.email.trim() || null : null
    if ('company' in body) updates.company = typeof body.company === 'string' ? body.company.trim() || null : null
    let temperatureChanged = false
    if ('lead_temperature' in body) {
      const next =
        typeof body.lead_temperature === 'string' && LEAD_TEMPERATURES.has(body.lead_temperature as LeadTemperature)
          ? (body.lead_temperature as LeadTemperature)
          : null
      updates.lead_temperature = next
      temperatureChanged = next !== (existing.lead_temperature ?? null)
      // Stamp the change so the auto-cool sweep (migration 103) gives a
      // freshly (re)classified lead its own full grace period.
      if (temperatureChanged) updates.lead_temperature_updated_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .maybeSingle()

    if (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'A contact with this phone number already exists.' },
          { status: 409 }
        )
      }
      console.error('Error updating contact:', error)
      return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    if (temperatureChanged) {
      void dispatchWebhookEvent(supabaseAdmin(), accountId, 'contact.lead_temperature_changed', {
        contact_id: data.id,
        lead_temperature: data.lead_temperature,
      })
    }

    return NextResponse.json({ success: true, contact: data })
  } catch (error) {
    console.error('Error in contacts/[id] PATCH:', error)
    return toErrorResponse(error)
  }
}
