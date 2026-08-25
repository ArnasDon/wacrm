// ============================================================
// Meta Conversions API (CRM integration) — reports ad-originated
// leads back to Meta so ad delivery can optimize on real leads, not
// just clicks. See Events Manager → Data Sources → your dataset →
// "CRM integration" for the setup guide this mirrors.
//
// Scope (intentionally narrow): only the initial "Lead" event, fired
// once from src/app/api/leads/redirect/route.ts at the moment an ad
// click is assigned to a seller. No later pipeline-stage events yet —
// that's a deliberate, separate decision for later, not an oversight.
//
// Credentials are per-organization (organizations.meta_capi_*, see
// 049_meta_conversions_api.sql) since each store owner has their own
// Meta Business dataset/ad account — unlike uazapi's platform-wide
// reseller credentials, there's nothing to share across tenants here.
// ============================================================

import crypto from 'crypto'
import { decrypt } from './whatsapp/encryption'

const GRAPH_API_VERSION = 'v26.0'

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Meta requires lowercased, trimmed values hashed with SHA-256 for matching fields. */
function normalizeAndHash(value: string): string {
  return sha256Hex(value.trim().toLowerCase())
}

/** E.164-ish digits only, per Meta's phone-matching spec (country code + number, no symbols). */
function normalizePhoneAndHash(phoneDigits: string): string {
  return sha256Hex(phoneDigits.replace(/\D/g, ''))
}

export interface MetaLeadEventInput {
  datasetId: string
  /** Already-decrypted access token. */
  accessToken: string
  /** Unix seconds. */
  eventTime: number
  /** CRM's own lead id (ad_leads.id) — sent as a string; Meta's own "lead_id" concept is form-ads-specific and doesn't apply to a click-to-WhatsApp redirect, so this is omitted rather than sent incorrectly. */
  leadEventSource?: string
  phone?: string | null
  email?: string | null
  /** Meta's `fbc` click-id cookie/param format: `fb.1.<ts>.<fbclid>`. */
  fbc?: string | null
  /** Optional — lets a test send show up under Events Manager's "Test events" tab instead of production. */
  testEventCode?: string
}

export interface MetaLeadEventResult {
  ok: boolean
  status: number
  body: unknown
}

/**
 * Sends one "Lead" server event to Meta's Conversions API. Fire this
 * with a short timeout and never let a failure here block the
 * customer's own redirect to WhatsApp — see the caller in
 * leads/redirect/route.ts for that guard.
 */
export async function sendMetaLeadEvent(input: MetaLeadEventInput): Promise<MetaLeadEventResult> {
  const userData: Record<string, unknown> = {}
  if (input.phone) userData.ph = [normalizePhoneAndHash(input.phone)]
  if (input.email) userData.em = [normalizeAndHash(input.email)]
  if (input.fbc) userData.fbc = input.fbc

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: input.eventTime,
        action_source: 'system_generated',
        custom_data: {
          event_source: 'crm',
          lead_event_source: input.leadEventSource ?? 'WGA CRM',
        },
        user_data: userData,
      },
    ],
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    input.datasetId,
  )}/events?access_token=${encodeURIComponent(input.accessToken)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, body }
  } finally {
    clearTimeout(timeout)
  }
}

export interface OrgMetaCapiConfig {
  datasetId: string
  accessToken: string
}

/**
 * Decrypts an organization row's stored Meta CAPI credentials, or
 * returns null if not configured/enabled — the one guard every
 * caller needs before trying to send an event.
 */
export function resolveOrgMetaCapiConfig(org: {
  meta_capi_enabled?: boolean | null
  meta_capi_dataset_id?: string | null
  meta_capi_access_token?: string | null
}): OrgMetaCapiConfig | null {
  if (!org.meta_capi_enabled) return null
  if (!org.meta_capi_dataset_id || !org.meta_capi_access_token) return null
  try {
    return {
      datasetId: org.meta_capi_dataset_id,
      accessToken: decrypt(org.meta_capi_access_token),
    }
  } catch (err) {
    console.error('[meta-capi] failed to decrypt stored access token:', err)
    return null
  }
}
