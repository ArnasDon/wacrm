import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  deleteMessageTemplate,
  editMessageTemplate,
} from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'

/**
 * Per-template lifecycle endpoint.
 *
 * PATCH  — edit an existing Meta-side template (and re-submit). Used
 *          by the "Edit" action on APPROVED rows and the "Resubmit"
 *          action on REJECTED / PAUSED rows. Meta replaces components
 *          wholesale on edit and bumps status back to PENDING.
 *
 * DELETE — remove the template on Meta (when meta_template_id is set,
 *          scoped to a single language variant via hsm_id) AND drop
 *          the local row. Local-only rows skip the Meta call.
 *
 * Initial submission (DRAFT → PENDING) lives at the sibling
 * /submit endpoint — keep this route narrowly about lifecycle of
 * already-submitted templates.
 */

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED'])

// uuid v4 plus the looser shape Postgres gen_random_uuid emits.
// We don't need exhaustive RFC parsing — just enough to reject
// "../etc/passwd"-style payloads before they hit Supabase.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    // Editing an already-submitted template re-submits it to Meta —
    // settings-class data: `canEditSettings` and the message_templates
    // update RLS policy (migration 017) both require 'admin'. Resolving
    // account_id off the profile only proved membership, so a viewer or
    // agent could push a real edit to Meta (consuming its edit-rate
    // limit and flipping an APPROVED template back to PENDING) — an
    // external side effect RLS can't undo — before the local update was
    // refused. Same fix already applied to templates/submit and
    // templates/sync.
    const { supabase, accountId } = await requireRole('admin')

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    // RLS handles ownership, but we need the existing row to read
    // meta_template_id and status — fetch explicitly.
    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, status, meta_template_id, language')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (!existing.meta_template_id) {
      return NextResponse.json(
        {
          error:
            'This template was never submitted to Meta — use New Template to submit it instead.',
        },
        { status: 400 },
      )
    }

    if (!EDITABLE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        {
          error: `Templates in status ${existing.status} cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.`,
        },
        { status: 400 },
      )
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not editable here — manage them in Meta WhatsApp Manager.',
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

    if (!isDryRun()) {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single()
      if (configError || !config) {
        return NextResponse.json(
          { error: 'WhatsApp not configured.' },
          { status: 400 },
        )
      }
      const accessToken = decrypt(config.access_token)

      // Image headers need a fresh Resumable-Upload handle on every edit
      // (Meta replaces components wholesale). Derive from header_media_url.
      try {
        await ensureImageHeaderHandle(payload, accessToken)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Header image upload failed.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        await editMessageTemplate({
          metaTemplateId: existing.meta_template_id,
          accessToken,
          components: metaPayload.components,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta edit failed.'
        await supabase
          .from('message_templates')
          .update({
            submission_error: message,
            last_submitted_at: new Date().toISOString(),
          })
          .eq('id', id)
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    // Meta accepted the edit — status flips back to PENDING for review.
    const { data: row, error: updErr } = await supabase
      .from('message_templates')
      .update({
        category: payload.category,
        header_type: payload.header_type ?? null,
        header_content: payload.header_content ?? null,
        header_media_url: payload.header_media_url ?? null,
        header_handle: payload.header_handle ?? null,
        body_text: payload.body_text,
        footer_text: payload.footer_text ?? null,
        buttons: payload.buttons ?? null,
        sample_values: payload.sample_values ?? null,
        status: 'PENDING',
        submission_error: null,
        rejection_reason: null,
        last_submitted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updErr) {
      return NextResponse.json(
        {
          error: `Edited on Meta but failed to save locally: ${updErr.message}. Run "Sync from Meta" to recover.`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: isDryRun(),
    })
  } catch (error) {
    // Auth failures map to 401/403 rather than being folded into the
    // generic 500 below, which surfaces `error.message` as an edit
    // failure — reporting "you aren't an admin" that way would send the
    // user chasing the wrong problem.
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error editing template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to edit template.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    // Deleting a submitted template removes it on Meta too — same
    // settings-class rationale as the PATCH handler above: `admin` is
    // required so a viewer/agent can't trigger an irreversible Meta-side
    // delete before the local (RLS-gated) delete is refused.
    const { supabase, accountId } = await requireRole('admin')

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (existing.meta_template_id && !isDryRun()) {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single()
      if (configError || !config || !config.waba_id) {
        return NextResponse.json(
          { error: 'WhatsApp not configured — cannot delete on Meta.' },
          { status: 400 },
        )
      }
      const accessToken = decrypt(config.access_token)
      try {
        await deleteMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.meta_template_id,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta delete failed.'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    const { error: delErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
    if (delErr) {
      return NextResponse.json(
        {
          error: `Deleted on Meta but failed to delete locally: ${delErr.message}.`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, dry_run: isDryRun() })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error deleting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to delete template.',
      },
      { status: 500 },
    )
  }
}
