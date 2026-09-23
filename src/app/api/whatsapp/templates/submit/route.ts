import { NextResponse } from 'next/server'
import { resolveMetaChannel } from '@/lib/cb-channels/resolve-meta'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureMediaHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    // Original author — kept as audit only. The unique index is
    // still on (user_id, name, language) — see the upsert helper
    // for the cross-teammate dedup follow-up.
    user_id: userId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function upsertTemplateRow(
  supabase: SupabaseClient,
  row: ReturnType<typeof buildUpsertRow> & { channel_id?: string | null },
) {
  // ⚠️ NAO usa `.upsert(..., { onConflict })`. A migration 903 trocou o unico
  // indice (user_id, name, language) por DOIS indices PARCIAIS — um para os
  // modelos globais (channel_id IS NULL) e um por canal — porque o mesmo nome
  // de modelo passa a ser legitimo em dois WABAs. Indice parcial nao serve
  // como alvo de ON CONFLICT, entao o upsert quebraria.
  //
  // Lookup + insert/update escopado ao canal, no mesmo formato que a rota de
  // sync ja usa.
  let lookup = supabase
    .from('message_templates')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('name', row.name)
    .eq('language', row.language)
  lookup = row.channel_id
    ? lookup.eq('channel_id', row.channel_id)
    : lookup.is('channel_id', null)

  const { data: existente } = await lookup.maybeSingle()

  if (existente?.id) {
    return supabase
      .from('message_templates')
      .update(row)
      .eq('id', existente.id)
      .select()
      .single()
  }
  return supabase.from('message_templates').insert(row).select().single()
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (user_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
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

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

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

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string

    // Canal escolhido no corpo; o modelo nasce carimbado com ele.
    const canalPedido =
      typeof (payload as { channel_id?: unknown }).channel_id === 'string'
        ? ((payload as { channel_id?: string }).channel_id as string)
        : null
    let canalDoModelo: string | null = canalPedido

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      // Multi-canal: cria o modelo no WABA do canal PEDIDO. Antes ia sempre
      // para o WABA do espelho — o operador cadastrava o 2o numero, criava um
      // modelo achando que era "do numero 2", e ele nascia no WABA do 1o.
      const canal = await resolveMetaChannel(supabase, accountId, canalPedido)
      if (!canal) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect an official Meta (Cloud API) number in Settings > Connections first.',
          },
          { status: 400 },
        )
      }
      if (!canal.wabaId) {
        return NextResponse.json(
          {
            error: `WABA (WhatsApp Business Account) ID missing for "${canal.label}". Re-connect that number in Settings.`,
          },
          { status: 400 },
        )
      }
      canalDoModelo = canal.channelId

      const accessToken = decrypt(canal.accessToken)

      // Media headers (image/video/document) need a Resumable-Upload
      // handle (Meta rejects a plain URL at creation). Derive it from
      // header_media_url before building the payload. Surfaces a 400 with
      // an actionable message (missing META_APP_ID, unreachable URL,
      // wrong type/size).
      try {
        await ensureMediaHeaderHandle(payload, accessToken)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Header media upload failed.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        const meta = await submitMessageTemplate({
          wabaId: canal.wabaId,
          accessToken,
          payload: metaPayload,
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        // Persist the failure so the user can retry; row stays DRAFT
        // until they fix and re-submit.
        await upsertTemplateRow(
          supabase,
          {
            ...buildUpsertRow(accountId, userId, payload, {
              status: 'DRAFT',
              metaTemplateId: null,
              submissionError: message,
            }),
            channel_id: canalDoModelo,
          },
        )
        const isRateLimit = /\b429\b/.test(message)
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 },
        )
      }
    }

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      {
        ...buildUpsertRow(accountId, userId, payload, {
          status: normalizeStatus(metaStatus),
          metaTemplateId,
          submissionError: null,
        }),
        channel_id: canalDoModelo,
      },
    )

    if (upsertErr) {
      // The submit succeeded on Meta's side but we failed to persist
      // locally. That's a data-drift state — surface the meta_template_id
      // so the user can recover via "Sync from Meta".
      return NextResponse.json(
        {
          error: `Submitted to Meta but failed to save locally: ${upsertErr.message}. Run "Sync from Meta" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
    })
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
