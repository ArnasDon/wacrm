import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { loadChannelById, loadDefaultChannel } from '@/lib/whatsapp/channels'
import { submitAndSaveTemplate } from '@/lib/whatsapp/template-submit'

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → validate → resolve the channel (body `channel_id`, else the
 * account's default) → (DRY_RUN short-circuit) → POST to the channel's
 * WABA → upsert the local row by (account_id, waba_id, name, language)
 * with status, meta_template_id, sample_values, last_submitted_at.
 * The shared core lives in `@/lib/whatsapp/template-submit`.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — a row can only be
 * submitted; editing or deleting requires hsm_id and lives in PR 4.
 */
export async function POST(request: Request) {
  try {
    // Message templates are settings-class data: `canEditSettings` and the
    // message_templates_insert/update RLS policies (migration 017) both
    // require 'admin'. Resolving account_id off the profile only proved
    // membership, so a viewer or agent could push a template to Meta for
    // approval — an external side effect RLS can't roll back — before the
    // local upsert was refused.
    const { supabase, accountId, userId } = await requireRole('admin')

    let body: TemplatePayload & { channel_id?: string }
    try {
      body = (await request.json()) as TemplatePayload & { channel_id?: string }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const { channel_id: channelId, ...payload } = body

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
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

    // The WABA the template is created in (migration 047): the channel
    // picked on the Templates page, else the account's default.
    const channel = channelId
      ? await loadChannelById(supabase, accountId, channelId)
      : await loadDefaultChannel(supabase, accountId)
    if (channelId && !channel) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    return await submitAndSaveTemplate({ supabase, accountId, userId, payload, channel })
  } catch (error) {
    // Auth failures map to 401/403. Handled before the generic branch
    // below, which surfaces `error.message` as a 500 — reporting "you
    // aren't an admin" as a template submission failure would send the
    // user chasing the wrong problem.
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
