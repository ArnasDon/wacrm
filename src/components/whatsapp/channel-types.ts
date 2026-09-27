/** A channel row as returned by GET /api/whatsapp/channels (no tokens). */
export interface Channel {
  id: string;
  name: string | null;
  color: string;
  is_default: boolean;
  phone_number_id: string;
  waba_id: string | null;
  waba_name: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  /** Meta's state for the number: CONNECTED, PENDING, FLAGGED, RESTRICTED, ... */
  meta_status: string | null;
  code_verification_status: string | null;
  name_status: string | null;
  account_mode: string | null;
  is_official_business_account: boolean | null;
  country_code: string | null;
  country_dial_code: string | null;
  /** Meta's throughput class: STANDARD, HIGH, NOT_APPLICABLE */
  throughput_level: string | null;
  /** The callback Meta actually delivers this number's webhooks to. */
  webhook_url: string | null;
  status: 'connected' | 'disconnected';
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
  connected_at: string | null;
  meta_synced_at: string | null;
  created_at: string;
}

export interface WebhookInfo {
  url: string;
  verify_token: string | null;
}

/** Error body every channel route answers with on failure. */
export interface ChannelApiError {
  error?: string;
  field?: string | null;
  meta?: { code?: number | null; fbtrace_id?: string | null } | null;
}

export type ChannelState = 'connected' | 'pending' | 'disconnected' | 'restricted' | 'flagged';

/**
 * Meta's own status for the number wins (from the last verify/refresh);
 * a phone registration Meta rejected here counts as pending (retry with
 * the right PIN). Without either, the locally saved status decides.
 */
export function channelState(c: Channel): ChannelState {
  if (c.last_registration_error) return 'pending';
  switch ((c.meta_status ?? '').toUpperCase()) {
    case 'CONNECTED':
      return 'connected';
    case 'PENDING':
    case 'UNVERIFIED':
    case 'MIGRATED':
      return 'pending';
    case 'FLAGGED':
      return 'flagged';
    case 'RESTRICTED':
    case 'RATE_LIMITED':
    case 'BANNED':
      return 'restricted';
    case 'DISCONNECTED':
    case 'DELETED':
    case 'UNKNOWN':
      return 'disconnected';
  }
  return c.status === 'connected' ? 'connected' : 'disconnected';
}

export type Quality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export function channelQuality(c: Channel): Quality {
  const q = (c.quality_rating ?? '').toUpperCase();
  return q === 'GREEN' || q === 'YELLOW' || q === 'RED' ? q : 'UNKNOWN';
}

/** TIER_1K → "1K", TIER_UNLIMITED → "UNLIMITED"; null when unknown. */
export function tierLimit(c: Channel): string | null {
  const m = /^TIER_(.+)$/i.exec(c.messaging_limit_tier ?? '');
  return m ? m[1].toUpperCase() : null;
}

/** One API error body → a single readable line, with Meta's trace id if any. */
export function describeApiError(body: ChannelApiError | null, fallback: string): string {
  const text = body?.error || fallback;
  const code = body?.meta?.code;
  const trace = body?.meta?.fbtrace_id;
  const extra = [code != null ? `code ${code}` : null, trace ? `fbtrace_id ${trace}` : null]
    .filter(Boolean)
    .join(', ');
  return extra ? `${text} (${extra})` : text;
}
