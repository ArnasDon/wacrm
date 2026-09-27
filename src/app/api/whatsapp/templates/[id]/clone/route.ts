import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadChannelById, loadChannelForWaba } from '@/lib/whatsapp/channels'
import { submitAndSaveTemplate } from '@/lib/whatsapp/template-submit'
import {
  validateTemplateName,
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { isMediaHeaderKind } from '@/lib/whatsapp/media-header-types'
import type { MessageTemplate } from '@/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The public sample URL to re-upload a media header from. Meta upload
 * handles are single-use per template, so a clone always re-uploads:
 * from our stored copy (`header_media_url`) or, for templates synced
 * from Meta, the sample URL Meta returned in `header_handle`.
 */
function mediaSampleUrl(t: MessageTemplate): string | undefined {
  if (t.header_media_url) return t.header_media_url
  if (t.header_handle && /^https?:\/\//i.test(t.header_handle)) return t.header_handle
  return undefined
}

/**
 * POST /api/whatsapp/templates/:id/clone
 *
 * Body: { name, channel_id? }. Copies the template — category, language,
 * header, body, footer, buttons and sample values — under a new name and
 * submits the copy to Meta for approval. Goes to `channel_id`'s WABA when
 * given (copying between WABAs), else to the source template's own WABA.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid template id.' }, { status: 400 })
    }
    // Same bar as creating a template: settings-class data, and the
    // submit is a Meta-side side effect RLS can't roll back.
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown
      channel_id?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    try {
      validateTemplateName(name)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid template name.', field: 'name' },
        { status: 400 },
      )
    }

    const { data: source, error: lookupErr } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !source) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }
    const template = source as MessageTemplate
    const language = template.language || 'en_US'

    if (template.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates cannot be cloned here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    const channelId = typeof body.channel_id === 'string' ? body.channel_id : null
    const channel = channelId
      ? await loadChannelById(supabase, accountId, channelId)
      : await loadChannelForWaba(supabase, accountId, template.waba_id)
    if (channelId && !channel) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }
    const targetWaba = channel?.waba_id ?? template.waba_id ?? null

    // The save upserts on (account, WABA, name, language) — refuse rather
    // than silently overwrite an existing template of that name.
    let clash = supabase
      .from('message_templates')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', name)
      .eq('language', language)
    clash = targetWaba ? clash.eq('waba_id', targetWaba) : clash.is('waba_id', null)
    const { data: existing } = await clash.limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error: `A template named "${name}" (${language}) already exists in this channel. Choose another name.`,
          field: 'name',
        },
        { status: 409 },
      )
    }

    const mediaHeader = isMediaHeaderKind(template.header_type)
    const payload: TemplatePayload = {
      name,
      category: template.category,
      language,
      header_type: template.header_type ?? undefined,
      header_content:
        template.header_type === 'text' ? (template.header_content ?? undefined) : undefined,
      header_media_url: mediaHeader ? mediaSampleUrl(template) : undefined,
      body_text: template.body_text,
      footer_text: template.footer_text ?? undefined,
      buttons: template.buttons?.length ? template.buttons : undefined,
      sample_values: template.sample_values ?? undefined,
    }

    if (mediaHeader && !payload.header_media_url) {
      return NextResponse.json(
        {
          error:
            'This template has no stored sample for its media header, so it cannot be copied as-is. Create the copy with "New Template" and upload the header media.',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    return await submitAndSaveTemplate({ supabase, accountId, userId, payload, channel })
  } catch (err) {
    return toErrorResponse(err)
  }
}
