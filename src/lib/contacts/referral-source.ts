import type { SupabaseClient } from '@supabase/supabase-js'

export interface ContactReferralSource {
  source_type?: string
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

type ReferralField = keyof ContactReferralSource

const TEXT_FIELD_LIMITS: Partial<Record<ReferralField, number>> = {
  source_type: 32,
  source_id: 128,
  headline: 500,
  body: 2000,
  media_type: 32,
  ctwa_clid: 512,
}

const URL_FIELDS: ReferralField[] = [
  'source_url',
  'image_url',
  'video_url',
  'thumbnail_url',
]

const MAX_URL_LENGTH = 2048

export function safeReferralUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return Array.from(trimmed).slice(0, maxLength).join('')
}

export function parseReferral(raw: unknown): ContactReferralSource | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const referral: ContactReferralSource = {}

  for (const [field, limit] of Object.entries(TEXT_FIELD_LIMITS)) {
    const text = boundedText(input[field], limit as number)
    if (text) referral[field as ReferralField] = text
  }
  if (referral.source_type) referral.source_type = referral.source_type.toLowerCase()
  if (referral.media_type) referral.media_type = referral.media_type.toLowerCase()

  for (const field of URL_FIELDS) {
    const url = safeReferralUrl(input[field])
    if (url) referral[field] = url
  }

  return Object.keys(referral).length > 0 ? referral : null
}

export function referralReceivedAt(metaTimestamp: unknown, now = new Date()): string {
  const seconds = Number(metaTimestamp)
  const received = new Date(seconds * 1000)
  if (!Number.isFinite(seconds) || seconds <= 0 || Number.isNaN(received.getTime())) {
    return now.toISOString()
  }
  return received.toISOString()
}

export async function captureReferralSource(
  db: SupabaseClient,
  contactId: string,
  raw: unknown,
  metaTimestamp: unknown
): Promise<boolean> {
  const referral = parseReferral(raw)
  if (!referral) return false
  const receivedAt = referralReceivedAt(metaTimestamp)

  const { data, error } = await db
    .from('contacts')
    .update({ referral_source: referral, referral_received_at: receivedAt })
    .eq('id', contactId)
    .is('referral_source', null)
    .select('id')

  if (error) {
    console.error('[webhook] referral source capture failed:', error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}
