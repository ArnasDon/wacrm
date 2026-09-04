import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import { createZernioTemplate } from '@/lib/zernio/api'
import { SendMessageError } from '@/lib/messaging/types'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import {
  buildMetaTemplatePayload,
  metaComponentsToZernio,
} from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
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
    whatsappConfigId: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    // Original author — kept as audit only. The identity/conflict
    // target is whatsapp_config_id (migration 050) — Meta templates
    // are approved per-WABA, not per-account, so two numbers on the
    // same account can each hold a template with the same name.
    user_id: userId,
    whatsapp_config_id: extras.whatsappConfigId,
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
  row: ReturnType<typeof buildUpsertRow>,
) {
  // Conflict target is (whatsapp_config_id, name, language) — migration
  // 050 replaced the legacy (user_id, name, language) index, which both
  // let two teammates shadow each other's same-named template AND
  // couldn't model that the same template name is legitimately distinct
  // per WABA/number.
  return supabase
    .from('message_templates')
    .upsert(row, { onConflict: 'whatsapp_config_id,name,language' })
    .select()
    .single()
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config (optionally a specific `whatsapp_config_id`
 * from the request body; defaults to the account's default connection) →
 * validate → (DRY_RUN short-circuit) → POST to Meta → upsert local row by
 * (whatsapp_config_id, name, language) with status, meta_template_id,
 * sample_values, last_submitted_at.
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
    let requestedConfigId: string | null = null
    try {
      const body = (await request.json()) as TemplatePayload & {
        whatsapp_config_id?: string
      }
      requestedConfigId = body.whatsapp_config_id ?? null
      payload = body
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
    // Resolved once, up front, so both the dry-run and real-submit
    // branches stamp the same whatsapp_config_id on the local row.
    const resolvedConfig = await resolveWhatsAppConfig(
      supabase,
      accountId,
      requestedConfigId,
    )
    const resolvedConfigId: string | null = resolvedConfig?.id ?? null

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      const config = resolvedConfig
      if (!config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
          },
          { status: 400 },
        )
      }

      if (config.provider === 'zernio') {
        // Image-header handles are scoped to the Meta App that
        // uploaded them (see ensureImageHeaderHandle) — Zernio submits
        // through its own app, so a handle minted with our
        // META_APP_ID would be meaningless there. Text/no-header
        // templates have no such dependency.
        if (payload.header_type === 'image') {
          return NextResponse.json(
            {
              error:
                'Image-header templates are not yet supported for Zernio-connected WhatsApp accounts. Use a text header, or connect WhatsApp directly to Meta instead.',
            },
            { status: 400 },
          )
        }
        const metaPayload = buildMetaTemplatePayload(payload)
        try {
          const created = await createZernioTemplate({
            apiKey: decrypt(config.zernio_api_key),
            accountId: config.zernio_account_id,
            name: payload.name,
            // Meta (and Zernio, which proxies it) require the uppercase
            // enum — MARKETING / UTILITY / AUTHENTICATION. `payload.category`
            // is the form's title-case label; `metaPayload.category` is the
            // normalised value the direct-Meta path already sends.
            category: metaPayload.category,
            language: payload.language,
            // Zernio's create endpoint validates components with a
            // lowercase-`type` discriminator, unlike Meta's own API.
            components: metaComponentsToZernio(metaPayload.components ?? []),
          })
          metaTemplateId = created.id
          metaStatus = created.status
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Zernio submit failed.'
          await upsertTemplateRow(
            supabase,
            buildUpsertRow(accountId, userId, payload, {
              status: 'DRAFT',
              metaTemplateId: null,
              submissionError: message,
              whatsappConfigId: resolvedConfigId,
            }),
          )
          // A `SendMessageError` is a real rejection Zernio/Meta sent
          // back — surface its actual message (never "[object Object]",
          // which the old string coercion produced for a nested error
          // body). Anything else (a plain Error from `zernioFetch`: the
          // 12s timeout or a network blip) means Meta may still be
          // creating the template behind a slow response — say so
          // instead of leaking a bare 502.
          const clientMessage =
            e instanceof SendMessageError
              ? message
              : 'La solicitud se envió pero Meta está tardando en responder. Espera unos minutos y usa "Sincronizar desde Meta"; si no aparece, vuelve a intentarlo.'
          const clientStatus =
            e instanceof SendMessageError &&
            e.status >= 400 &&
            e.status < 600
              ? e.status
              : 502
          return NextResponse.json(
            { error: clientMessage },
            { status: clientStatus },
          )
        }
      } else {
        if (!config.waba_id) {
          return NextResponse.json(
            {
              error:
                'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
            },
            { status: 400 },
          )
        }

        const accessToken = decrypt(config.access_token)

        // Image headers need a Resumable-Upload handle (Meta rejects a
        // plain URL at creation). Derive it from header_media_url before
        // building the payload. Surfaces a 400 with an actionable message
        // (missing META_APP_ID, unreachable URL, wrong type/size).
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
          const meta = await submitMessageTemplate({
            wabaId: config.waba_id,
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
            buildUpsertRow(accountId, userId, payload, {
              status: 'DRAFT',
              metaTemplateId: null,
              submissionError: message,
              whatsappConfigId: resolvedConfigId,
            }),
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
    }

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      buildUpsertRow(accountId, userId, payload, {
        status: normalizeStatus(metaStatus),
        metaTemplateId,
        submissionError: null,
        whatsappConfigId: resolvedConfigId,
      }),
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
