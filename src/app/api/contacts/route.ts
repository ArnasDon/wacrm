import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import type { LeadTemperature } from '@/types'

const LEAD_TEMPERATURES = new Set<LeadTemperature>(['cold', 'warm', 'hot'])

/**
 * POST /api/contacts
 *
 * Creates a contact — the server-side counterpart to the dashboard
 * "Add Contact" form (src/components/contacts/contact-form.tsx), which
 * used to insert directly into Supabase from the browser. Moved
 * server-side so contact creation fires `contact.created`, matching
 * the inbound-webhook contact-creation paths that already dispatch it.
 *
 * Body: { name?, phone, email?, company?, lead_temperature? }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 })
    }
    const leadTemperature =
      typeof body?.lead_temperature === 'string' && LEAD_TEMPERATURES.has(body.lead_temperature as LeadTemperature)
        ? (body.lead_temperature as LeadTemperature)
        : null

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        user_id: userId,
        account_id: accountId,
        name: typeof body?.name === 'string' ? body.name.trim() || null : null,
        phone,
        email: typeof body?.email === 'string' ? body.email.trim() || null : null,
        company: typeof body?.company === 'string' ? body.company.trim() || null : null,
        lead_temperature: leadTemperature,
      })
      .select('*')
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'A contact with this phone number already exists.' },
          { status: 409 }
        )
      }
      console.error('Error creating contact:', error)
      return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
    }

    void dispatchWebhookEvent(supabaseAdmin(), accountId, 'contact.created', {
      contact_id: data.id,
      phone: data.phone,
      name: data.name,
      source: 'dashboard',
    })

    return NextResponse.json({ success: true, contact: data })
  } catch (error) {
    console.error('Error in contacts POST:', error)
    return toErrorResponse(error)
  }
}
