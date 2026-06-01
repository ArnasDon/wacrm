/**
 * Handlers for Meta's template-lifecycle webhook events.
 *
 * Meta delivers three template-related webhook fields, each with a
 * different `value` shape:
 *
 *   - message_template_status_update      — APPROVED / REJECTED / PAUSED / etc.
 *   - message_template_quality_update     — GREEN / YELLOW / RED quality score
 *   - message_template_components_update  — Meta auto-modified the template
 *
 * The route handler at /api/whatsapp/webhook receives every change and
 * delegates here when `change.field` starts with `message_template_`.
 *
 * ─── Setup requirement (out-of-band) ──────────────────────────────
 * These fields are NOT subscribed to by default. In Meta App Dashboard
 * → WhatsApp → Configuration → Webhooks, you must explicitly toggle
 * each of the three fields above. There is no API to do this for
 * Cloud API apps — it's a one-time manual step per app. Until that's
 * done, status updates only land via the manual "Sync from Meta"
 * button (the legacy fallback, intentionally preserved).
 *
 * ─── Multi-tenant note ────────────────────────────────────────────
 * `meta_template_id` is globally unique per WABA — the lookup doesn't
 * filter by user_id. If two wacrm tenants somehow ended up with the
 * same id (impossible in practice, but a theoretical race during
 * cross-tenant moves), the handler updates both rows and logs a
 * warning so operators can investigate.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeStatus } from './template-status-normalize'

const TEMPLATE_WEBHOOK_FIELDS = new Set([
  'message_template_status_update',
  'message_template_quality_update',
  'message_template_components_update',
])

export function isTemplateWebhookField(field: string): boolean {
  return TEMPLATE_WEBHOOK_FIELDS.has(field)
}

interface TemplateStatusUpdateValue {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  reason?: string
}

interface TemplateQualityUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  previous_quality_score?: string
  new_quality_score?: string
}

interface TemplateComponentsUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
}

export interface TemplateWebhookChange {
  field: string
  value: unknown
}

/**
 * Dispatch a single change record to the matching handler. Returns
 * silently on unrecognised fields — the caller already pre-filtered
 * via isTemplateWebhookField, but treat unknown values as no-ops
 * defensively in case Meta adds new template fields later.
 */
export async function handleTemplateWebhookChange(
  change: TemplateWebhookChange,
  // SupabaseClient typed loosely — the webhook route lazy-initialises
  // the admin client and exposes it as `any`. Type as the generic
  // SupabaseClient here so this module is testable in isolation.
  supabase: SupabaseClient,
): Promise<void> {
  switch (change.field) {
    case 'message_template_status_update':
      await handleStatusUpdate(
        change.value as TemplateStatusUpdateValue,
        supabase,
      )
      return
    case 'message_template_quality_update':
      await handleQualityUpdate(
        change.value as TemplateQualityUpdateValue,
        supabase,
      )
      return
    case 'message_template_components_update':
      handleComponentsUpdate(
        change.value as TemplateComponentsUpdateValue,
      )
      return
  }
}

async function handleStatusUpdate(
  value: TemplateStatusUpdateValue,
  supabase: SupabaseClient,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId || !value.event) {
    console.warn(
      '[template-webhook] status update missing message_template_id or event:',
      value,
    )
    return
  }

  const status = normalizeStatus(value.event)

  // Persist the rejection reason on REJECTED — that's the only event
  // where Meta sends a human-readable explanation. Clear it on any
  // other status flip so the UI doesn't show a stale REJECTED banner
  // after Meta re-approves a resubmitted template.
  const update: Record<string, unknown> = {
    status,
    rejection_reason:
      status === 'REJECTED' ? value.reason ?? 'Rejected by Meta' : null,
    submission_error: null,
  }

  const { data, error } = await supabase
    .from('message_templates')
    .update(update)
    .eq('meta_template_id', metaTemplateId)
    .select('id')

  if (error) {
    console.error(
      '[template-webhook] status update failed for meta_template_id',
      metaTemplateId,
      error.message,
    )
    return
  }
  if (!data || data.length === 0) {
    console.warn(
      '[template-webhook] status update received for unknown template:',
      metaTemplateId,
      value.message_template_name,
    )
    return
  }
  if (data.length > 1) {
    console.warn(
      `[template-webhook] status update matched ${data.length} rows for meta_template_id ${metaTemplateId} — investigate.`,
    )
  }
}

async function handleQualityUpdate(
  value: TemplateQualityUpdateValue,
  supabase: SupabaseClient,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId) {
    console.warn(
      '[template-webhook] quality update missing message_template_id:',
      value,
    )
    return
  }

  const raw = value.new_quality_score
  const score =
    raw && ['GREEN', 'YELLOW', 'RED'].includes(raw.toUpperCase())
      ? (raw.toUpperCase() as 'GREEN' | 'YELLOW' | 'RED')
      : null

  const { error } = await supabase
    .from('message_templates')
    .update({ quality_score: score })
    .eq('meta_template_id', metaTemplateId)

  if (error) {
    console.error(
      '[template-webhook] quality update failed for meta_template_id',
      metaTemplateId,
      error.message,
    )
  }
}

/**
 * Meta auto-modified the template (typically a category reclassification
 * — e.g. Marketing → Utility after content review).
 *
 * For v1 we just log and let the user pull updated components via the
 * existing "Sync from Meta" button — persisting Meta's modified
 * components without showing the user would silently change what they
 * thought they submitted. A future PR could mark the row with a
 * "Meta modified this template" banner.
 */
function handleComponentsUpdate(value: TemplateComponentsUpdateValue): void {
  console.info(
    '[template-webhook] components updated by Meta for template',
    value.message_template_id,
    value.message_template_name,
    '— run "Sync from Meta" in Settings to pull the new components.',
  )
}
