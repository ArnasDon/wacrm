import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { contactText } from '@/lib/automations/engine'
import { createResendClient, loadEmailConfig } from '@/lib/email/send'
import { supabaseAdmin } from '@/lib/telnyx/admin-client'
import type { VariableMapping } from '@/hooks/use-broadcast-sending'

// ============================================================
// POST /api/email/send — envía un email manualmente (agent+).
//   body: { contactId? | to?, template, variables? }
// Carga el template por nombre, interpola `{{ name }}`, `{{ email }}`,
// `{{ vars.* }}` con `contactText` (misma fuente de campos que el motor
// de automatizaciones, §9.3.1 — sin copiar lógica) y envía con Resend.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')

    let body: { contactId?: string; to?: string; template?: string; variables?: Record<string, VariableMapping> }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'bad body' }, { status: 400 })
    }

    const templateName = typeof body.template === 'string' ? body.template.trim() : ''
    if (!templateName) {
      return NextResponse.json({ error: 'template is required' }, { status: 400 })
    }

    // Resolver el destinatario: contactId (validando que sea del account) o `to` directo.
    let to = ''
    let contactFields: { name: string; email: string; phone: string; company: string } | null = null
    if (typeof body.contactId === 'string' && body.contactId) {
      const { data: contact, error } = await ctx.supabase
        .from('contacts')
        .select('name, email, phone, company')
        .eq('id', body.contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (error || !contact) {
        return NextResponse.json({ error: 'contact not found' }, { status: 404 })
      }
      to = contact.email ?? ''
      contactFields = {
        name: contact.name ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        company: contact.company ?? '',
      }
    } else if (typeof body.to === 'string' && body.to.trim()) {
      to = body.to.trim()
    }
    if (!to) {
      return NextResponse.json(
        { error: 'either contactId or to is required (and contact must have an email)' },
        { status: 400 },
      )
    }

    const { data: tpl } = await ctx.supabase
      .from('email_templates')
      .select('subject, body_html')
      .eq('account_id', ctx.accountId)
      .eq('name', templateName)
      .maybeSingle()
    const template = tpl as { subject: string; body_html: string } | null
    if (!template) {
      return NextResponse.json({ error: 'template not found' }, { status: 404 })
    }

    const variables = body.variables
    const subject = contactText(template.subject, variables, contactFields)
    const html = contactText(template.body_html, variables, contactFields)

    const { apiKey, fromEmail, replyTo } = await loadEmailConfig(ctx.accountId)
    const client = createResendClient(apiKey)
    const { id } = await client.send(fromEmail, replyTo, { to, subject, html })

    // Persistir en email_sends (DAD §7.7 — Item 13): snapshot html para el
    // visor + resend_message_id para el webhook. service_role (mismo patrón
    // que el motor de automatizaciones; RLS del browser no inserta directo).
    await supabaseAdmin().from('email_sends').insert({
      account_id: ctx.accountId,
      contact_id: typeof body.contactId === 'string' ? body.contactId : null,
      automation_id: null,
      template_name: templateName,
      recipient: to,
      subject,
      html,
      status: 'sent',
      resend_message_id: id,
    })

    return NextResponse.json({ ok: true, resendMessageId: id })
  } catch (err) {
    return toErrorResponse(err)
  }
}