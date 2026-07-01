import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendTemplateMessage,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import type { MessageTemplate } from '@/types'

/**
 * POST /api/conversations/start
 *
 * Starts a brand-new outbound WhatsApp conversation by:
 *  1. Resolving (or creating) the contact for the given phone number.
 *  2. Resolving (or creating) a conversation for that contact.
 *  3. Sending an approved template message to bootstrap the 24-hour window.
 *  4. Persisting the sent message in the DB.
 *
 * Body:
 *  - phone            {string}  – E.164-ish phone number (will be sanitised)
 *  - contact_name     {string?} – Optional display name to set on a new contact
 *  - template_name    {string}  – Approved Meta template name
 *  - template_language{string?} – BCP-47 language code (default "en_US")
 *  - template_params  {string[]?}– Legacy positional body params
 *  - template_message_params {object?} – Structured params (header/body/buttons)
 *
 * Returns:
 *  { conversation_id, contact_id, message_id, whatsapp_message_id }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve account_id — all CRM data is scoped per account, not per user.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      phone,
      contact_name,
      template_name,
      template_language,
      template_params,
      template_message_params,
    } = body

    // ── Validate inputs ───────────────────────────────────────────────────
    if (!phone || !template_name) {
      return NextResponse.json(
        { error: 'phone and template_name are required' },
        { status: 400 },
      )
    }

    const sanitizedPhone = sanitizePhoneForMeta(String(phone))
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number. Use international format, e.g. +1 555 000 1234.' },
        { status: 400 },
      )
    }

    // ── Load WhatsApp config ──────────────────────────────────────────────
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured. Go to Settings to connect your account.' },
        { status: 400 },
      )
    }

    if (config.status !== 'connected') {
      return NextResponse.json(
        { error: 'WhatsApp is not connected. Go to Settings to connect your account.' },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    // ── Load & validate the template row ─────────────────────────────────
    const lang = template_language || 'en_US'
    const { data: templateData } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', lang)
      .maybeSingle()

    if (!templateData) {
      return NextResponse.json(
        { error: `Template "${template_name}" not found. Make sure it is synced from Meta.` },
        { status: 404 },
      )
    }

    if (!isMessageTemplate(templateData)) {
      return NextResponse.json(
        { error: 'Template row is malformed — run "Sync from Meta" in Settings.' },
        { status: 500 },
      )
    }

    const templateRow: MessageTemplate = templateData

    if (templateRow.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Template "${template_name}" is not approved (status: ${templateRow.status ?? 'unknown'}).` },
        { status: 400 },
      )
    }

    // ── Resolve or create Contact ─────────────────────────────────────────
    // Check by phone (digits-only normalisation covers +/spaces).
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, phone, name')
      .eq('account_id', accountId)
      .eq('phone', sanitizedPhone)
      .maybeSingle()

    let contactId: string

    if (existingContact) {
      contactId = existingContact.id
      // Optionally back-fill the name if the caller provided one and the
      // contact currently has none.
      if (contact_name && !existingContact.name) {
        await supabase
          .from('contacts')
          .update({ name: contact_name })
          .eq('id', contactId)
      }
    } else {
      // Create a new contact owned by this account.
      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: user.id,
          phone: sanitizedPhone,
          name: contact_name || null,
        })
        .select('id')
        .single()

      if (contactErr || !newContact) {
        console.error('[conversations/start] contact insert failed:', contactErr)
        return NextResponse.json(
          { error: 'Failed to create contact.' },
          { status: 500 },
        )
      }
      contactId = newContact.id
    }

    // ── Resolve or create Conversation ───────────────────────────────────
    // Reuse an existing open/pending conversation so we don't fragment the
    // thread history. Prefer open → pending. If none exists, create one.
    const { data: existingConvs } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .in('status', ['open', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)

    let conversationId: string

    if (existingConvs && existingConvs.length > 0) {
      conversationId = existingConvs[0].id
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: user.id,
          contact_id: contactId,
          status: 'open',
          unread_count: 0,
        })
        .select('id')
        .single()

      if (convErr || !newConv) {
        console.error('[conversations/start] conversation insert failed:', convErr)
        return NextResponse.json(
          { error: 'Failed to create conversation.' },
          { status: 500 },
        )
      }
      conversationId = newConv.id
    }

    // ── Send the template via Meta ────────────────────────────────────────
    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phoneVariant: string): Promise<string> => {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phoneVariant,
        templateName: template_name,
        language: lang,
        template: templateRow,
        messageParams: template_message_params ?? undefined,
        params: template_params || [],
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(msg)) throw err
          lastError = err
          console.warn(`[conversations/start] variant "${variant}" rejected by Meta, trying next…`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[conversations/start] Meta send failed:', msg)
      return NextResponse.json(
        { error: `Meta API error: ${msg}` },
        { status: 502 },
      )
    }

    // Persist the corrected phone variant if it differed from what we stored.
    if (workingPhone !== sanitizedPhone) {
      await supabase
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contactId)
    }

    // ── Persist the message ───────────────────────────────────────────────
    const { data: messageRecord, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'template',
        content_text: templateRow.body_text || null,
        template_name,
        message_id: waMessageId,
        status: 'sent',
      })
      .select()
      .single()

    if (msgErr || !messageRecord) {
      console.error('[conversations/start] message insert failed:', msgErr)
      // The message was already delivered to Meta — return partial success
      // rather than a 500 that could cause the client to retry the send.
      return NextResponse.json({
        success: true,
        conversation_id: conversationId,
        contact_id: contactId,
        message_id: null,
        whatsapp_message_id: waMessageId,
        warning: 'Message sent but failed to save to DB.',
      })
    }

    // ── Update conversation preview ───────────────────────────────────────
    await supabase
      .from('conversations')
      .update({
        last_message_text: `[Template] ${template_name}`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('[conversations/start] unhandled error:', error)
    return NextResponse.json({ error: 'Failed to start conversation.' }, { status: 500 })
  }
}
