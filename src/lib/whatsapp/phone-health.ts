export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

export type MessagingLimit =
  | { kind: 'tier'; perDay: number }
  | { kind: 'unlimited' }

export interface PhoneHealth {
  state: 'connected' | 'disconnected' | 'unavailable'
  displayPhoneNumber: string | null
  quality: QualityRating
  limit: MessagingLimit | null
}

export function parseQualityRating(raw: string | null | undefined): QualityRating {
  const value = (raw ?? '').toUpperCase()
  return value === 'GREEN' || value === 'YELLOW' || value === 'RED' ? value : 'UNKNOWN'
}

export function parseMessagingLimit(raw: string | null | undefined): MessagingLimit | null {
  if (!raw) return null
  const value = raw.toUpperCase()
  if (value.includes('UNLIMITED')) return { kind: 'unlimited' }
  const match = /^TIER_(\d+)(K)?$/.exec(value)
  if (!match) return null
  const perDay = Number(match[1]) * (match[2] ? 1000 : 1)
  return Number.isFinite(perDay) && perDay > 0 ? { kind: 'tier', perDay } : null
}
