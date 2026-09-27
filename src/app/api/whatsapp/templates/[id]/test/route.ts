import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadChannelById, loadChannelForWaba } from '@/lib/whatsapp/channels'
import { decrypt } from '@/lib/whatsapp/encryption'
import { buildTemplateMessageRequest } from '@/lib/whatsapp/meta-api'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isRecipientNotAllowedError, parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import { isMediaHeaderKind } from '@/lib/whatsapp/media-header-types'
import type { MessageTemplate } from '@/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface TestBody {
  to?: unknown
  channel_id?: unknown
  body?: unknown
  header_text?: unknown
  header_media_url?: unknown
  button_params?: unknown
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')) : []

/**
 * POST /api/whatsapp/templates/:id/test
 *
 * Sends an APPROVED template to one phone number, straight through Meta,
 * so it can be checked on a real device before a broadcast. Nothing is
 * written to contacts or the inbox.
 *
 * Body: { to: "+15551234567", channel_id?, body?: string[],
 *         header_text?, header_media_url?, button_params?: {index: value} }
 * The channel must belong to the template's WABA — another WABA cannot
 * send it; without `channel_id` any channel of that WABA is used.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid template id.' }, { status: 400 })
    }
    // Sending a message — the same bar as sending from the inbox.
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = (await request.json().catch(() => ({}))) as TestBody

    const to = parseInternationalPhone(typeof body.to === 'string' ? body.to : null)
    if (!to) {
      return NextResponse.json(
        {
          error: 'Enter the phone number with a leading + and country code, e.g. +14155550123.',
          field: 'to',
        },
        { status: 400 },
      )
    }

    const { data: row } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }
    const template = row as MessageTemplate
    if (template.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Only templates Meta has approved can be sent. This one is still ' + (template.status ?? 'a draft').toLowerCase() + '.' },
        { status: 400 },
      )
    }

    const channelId = typeof body.channel_id === 'string' ? body.channel_id : null
    const channel = channelId
      ? await loadChannelById(supabase, accountId, channelId)
      : await loadChannelForWaba(supabase, accountId, template.waba_id)
    if (!channel) {
      return NextResponse.json(
        { error: channelId ? 'Channel not found.' : 'No connected channel can send this template.' },
        { status: channelId ? 404 : 400 },
      )
    }
    if (template.waba_id && channel.waba_id !== template.waba_id) {
      return NextResponse.json(
        {
          error:
            'This channel belongs to a different WhatsApp Business Account and cannot send this template. Pick a channel of the template’s own account.',
          field: 'channel_id',
        },
        { status: 400 },
      )
    }

    // Every body variable needs a value, or Meta rejects the send.
    const bodyValues = strings(body.body)
    const bodyVarCount = extractVariableIndices(template.body_text ?? '').length
    if (bodyValues.length < bodyVarCount || bodyValues.slice(0, bodyVarCount).some((v) => !v)) {
      return NextResponse.json(
        { error: `Fill in all ${bodyVarCount} variable value(s).`, field: 'body' },
        { status: 400 },
      )
    }

    const buttonParams: Record<number, string> = {}
    if (body.button_params && typeof body.button_params === 'object') {
      for (const [k, v] of Object.entries(body.button_params as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) buttonParams[Number(k)] = v.trim()
      }
    }

    let accessToken: string
    try {
      accessToken = decrypt(channel.access_token)
    } catch {
      return NextResponse.json(
        { error: 'The channel’s access token cannot be decrypted. Reconnect the channel on the WhatsApp page.' },
        { status: 400 },
      )
    }

    const headerMediaUrl =
      typeof body.header_media_url === 'string' && body.header_media_url.trim()
        ? body.header_media_url.trim()
        : undefined
    if (isMediaHeaderKind(template.header_type) && !headerMediaUrl && !template.header_media_url) {
      return NextResponse.json(
        {
          error: `This template has a ${template.header_type} header — give a public link to the ${template.header_type} to send.`,
          field: 'header_media_url',
        },
        { status: 400 },
      )
    }

    // Built here and sent directly (not via sendTemplateMessage) so the
    // test tool can show the exact request and Meta's raw response —
    // including the error body when Meta refuses.
    const { url, body: metaRequest } = buildTemplateMessageRequest({
      phoneNumberId: channel.phone_number_id,
      to,
      templateName: template.name,
      language: template.language || 'en_US',
      template,
      messageParams: {
        body: bodyValues.slice(0, bodyVarCount),
        headerText: typeof body.header_text === 'string' && body.header_text.trim() ? body.header_text.trim() : undefined,
        headerMediaUrl,
        buttonParams,
      },
    })

    let metaStatus: number
    let response: Record<string, unknown>
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(metaRequest),
      })
      metaStatus = res.status
      response = (await res.json().catch(() => ({}))) as Record<string, unknown>
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not reach Meta.', request: metaRequest },
        { status: 502 },
      )
    }

    const metaError = response.error as
      | { message?: string; error_user_title?: string; error_user_msg?: string; code?: number }
      | undefined
    if (metaStatus >= 400 || metaError) {
      let message =
        metaError?.error_user_msg
          ? `${metaError.error_user_title ? `${metaError.error_user_title}: ` : ''}${metaError.error_user_msg}`
          : metaError?.message || `Meta API error: ${metaStatus}`
      if (isRecipientNotAllowedError(`${metaError?.code ?? ''} ${message}`)) {
        message += ' — this channel is a Meta test number, which can only message numbers added to its allowed list in Meta → WhatsApp → API Setup.'
      }
      return NextResponse.json({ error: message, request: metaRequest, response }, { status: 502 })
    }

    const wamid = (response.messages as { id?: string }[] | undefined)?.[0]?.id ?? null
    // Recorded so the status webhooks Meta posts for this wamid can be
    // shown live (migration 048). Best-effort: the send already happened.
    if (wamid) {
      const { error: logError } = await supabaseAdmin()
        .from('template_test_sends')
        .insert({
          account_id: accountId,
          user_id: userId,
          template_id: template.id,
          whatsapp_config_id: channel.id,
          wamid,
          to_phone: to,
          request: metaRequest,
          response,
        })
      if (logError) console.warn('[template-test] could not record test send:', logError.message)
    }

    return NextResponse.json({
      success: true,
      message_id: wamid,
      to: `+${to}`,
      channel: channel.name ?? channel.display_phone_number ?? null,
      request: metaRequest,
      response,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
