import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import {
  resolveProviderConfig,
  buildProvider,
  sendWithPhoneRetry,
  interpolateBodyText,
  WhatsAppNotConfiguredError,
} from '@/lib/whatsapp/send-core'
import { isMetaProvider, type ProviderMediaKind } from '@/lib/whatsapp/provider-types'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

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

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id. whatsapp_config + templates
    // + broadcasts are all account-scoped post-multi-user, so the
    // old `.eq('user_id', user.id)` filters miss every row created
    // by a teammate.
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
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      body_text,
      media_url,
      media_kind,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name && !body_text) {
      return NextResponse.json(
        { error: 'template_name or body_text is required' },
        { status: 400 }
      )
    }

    let providerConfig
    try {
      providerConfig = await resolveProviderConfig(supabase, accountId)
    } catch (err) {
      if (err instanceof WhatsAppNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
    const provider = buildProvider(providerConfig)

    // Each provider has exactly one valid content source — Meta
    // requires an approved template (Meta's own policy; see
    // broadcast-core.ts for the same check on the public-API path),
    // uazapi has no such pipeline so it takes free text instead.
    const useTemplate = providerConfig.provider === 'meta'
    if (useTemplate && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required with the Meta provider' },
        { status: 400 }
      )
    }
    if (!useTemplate && !body_text) {
      return NextResponse.json(
        { error: 'body_text is required for broadcasts on this account’s provider' },
        { status: 400 }
      )
    }
    if (useTemplate && !isMetaProvider(provider)) {
      throw new Error('unreachable: provider guarded above')
    }

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    // Meta-only — the free-text path has no local row to validate.
    let templateRow = null
    if (useTemplate) {
      const { data: rawTemplateRow } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', template_name)
        .eq('language', template_language || 'en_US')
        .maybeSingle()
      if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
          },
          { status: 500 },
        )
      }
      templateRow = rawTemplateRow ?? null
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retry across phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      let sentMessageId: string | null = null
      let lastError: string | null = null

      try {
        const { result } = await sendWithPhoneRetry(sanitized, async (variant) => {
          if (useTemplate && isMetaProvider(provider)) {
            const r = await provider.sendTemplate({
              to: variant,
              templateName: template_name,
              language: template_language || 'en_US',
              template: templateRow ?? undefined,
              messageParams: recipient.messageParams,
              params: recipient.params ?? [],
            })
            return r.messageId
          }
          // Free-text path (uazapi, or any future non-template provider).
          const text = interpolateBodyText(body_text ?? '', recipient.params ?? [])
          if (media_url && media_kind) {
            const r = await provider.sendMedia({
              to: variant,
              kind: media_kind as ProviderMediaKind,
              link: media_url,
              caption: text || undefined,
            })
            return r.messageId
          }
          const r = await provider.sendText({ to: variant, text })
          return r.messageId
        })
        sentMessageId = result
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
