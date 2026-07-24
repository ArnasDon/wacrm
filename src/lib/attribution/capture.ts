/**
 * Capture where an inbound WhatsApp lead came from.
 *
 * Meta attaches a `referral` object to the first message a customer
 * sends after tapping a Click-to-WhatsApp ad. It is the only moment
 * the ad is ever named — it does not repeat on later messages, and
 * nothing else in the API links a phone number back to an ad. Miss it
 * and the lead is indistinguishable from a walk-in forever.
 *
 * Two writes per touch (see migration 037 for why both exist):
 *   - append a row to `attribution_events` (idempotent on wamid)
 *   - stamp first-touch columns on `contacts` (never overwritten)
 *
 * Both are best-effort by design: attribution is reporting metadata,
 * so a failure here must never cost the customer their message. Call
 * sites do not await a result they act on.
 */

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { DEFAULT_SOURCE, type ContactSource } from './sources';

/**
 * The `referral` object on an inbound message.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 *
 * Every field is optional: Status-placement ads omit `ctwa_clid`, and
 * Meta has added fields over time (`ref`, `welcome_message`).
 */
export interface WhatsAppReferral {
  /** The **ad id** (or post id when source_type is 'post'). */
  source_id?: string;
  /** 'ad' | 'post' — Meta documents these two. */
  source_type?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  /** Click id. Absent for WhatsApp Status placements. */
  ctwa_clid?: string;
  ref?: string;
  welcome_message?: { text?: string };
}

/** What we persist for one touch. */
export interface Attribution {
  source: ContactSource;
  adId: string | null;
  ctwaClid: string | null;
  headline: string | null;
  sourceUrl: string | null;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Callers derive `occurredAt` from the webhook's `timestamp` string.
 * A malformed one yields an Invalid Date, whose `.toISOString()`
 * throws a RangeError — which would turn a cosmetic timestamp problem
 * into a lost attribution. Fall back to now instead.
 */
function safeIso(date: Date): string {
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

/**
 * Map a raw referral to what we store. Pure — the whole decision is
 * testable without a database.
 *
 * `source_type: 'post'` is a click on an **organic** Facebook/Instagram
 * post, not an ad: there is no spend behind it, so counting it as
 * `meta_ads` would divide real spend by inflated leads and understate
 * cost per lead. It becomes `organic`; the post id is still kept in
 * `adId` and the raw payload, so the touch is not lost.
 *
 * Returns null when there is nothing worth recording — a referral with
 * no id tells us a customer arrived, which we already knew.
 */
export function referralToAttribution(
  referral: WhatsAppReferral | null | undefined,
): Attribution | null {
  if (!referral) return null;

  const adId = clean(referral.source_id);
  const ctwaClid = clean(referral.ctwa_clid);
  if (!adId && !ctwaClid) return null;

  const type = clean(referral.source_type)?.toLowerCase();
  // Unknown future source_types are treated as ads rather than
  // discarded: a new paid placement should not silently read as
  // organic and quietly distort cost per lead.
  const source: ContactSource = type === 'post' ? 'organic' : 'meta_ads';

  return {
    source,
    adId,
    ctwaClid,
    headline: clean(referral.headline),
    sourceUrl: clean(referral.source_url),
  };
}

/** Minimal shape of the Supabase client this module needs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export interface RecordTouchArgs {
  db: DB;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  /** WhatsApp message id — the idempotency key for webhook retries. */
  wamid?: string | null;
  referral: WhatsAppReferral | null | undefined;
  /** When the message arrived. Defaults to now. */
  occurredAt?: Date;
}

/**
 * Record one attribution touch. Safe to call for every inbound
 * message: messages without a referral (the vast majority) return
 * immediately without touching the database.
 *
 * Returns the attribution that was recorded, or null when there was
 * nothing to record — handy in tests and logs.
 */
export async function recordReferralTouch({
  db,
  accountId,
  contactId,
  conversationId = null,
  wamid = null,
  referral,
  occurredAt = new Date(),
}: RecordTouchArgs): Promise<Attribution | null> {
  const attribution = referralToAttribution(referral);
  if (!attribution) return null;

  const { error } = await db.from('attribution_events').insert({
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId,
    wamid,
    source: attribution.source,
    ad_id: attribution.adId,
    ctwa_clid: attribution.ctwaClid,
    headline: attribution.headline,
    source_url: attribution.sourceUrl,
    raw: referral,
    occurred_at: safeIso(occurredAt),
  });

  if (error) {
    // A webhook retry replaying the same message id. The first
    // delivery already recorded this touch — stop here so we don't
    // re-stamp the contact either.
    if (isUniqueViolation(error)) return attribution;
    console.error('[attribution] failed to log event:', error);
    // Fall through: the event log is the nice-to-have, the contact
    // stamp below is what the reports actually read.
  }

  await stampFirstTouch({ db, contactId, attribution, occurredAt, referral });
  return attribution;
}

/**
 * Write the first-touch columns, and only if the contact is still
 * unclassified.
 *
 * The `.eq('source', DEFAULT_SOURCE)` filter is the whole guard, and
 * it lives in the WHERE clause on purpose: a read-then-write would
 * race two concurrent inbound deliveries and could let the second ad
 * overwrite the first one's credit. Postgres settles it for us.
 */
async function stampFirstTouch({
  db,
  contactId,
  attribution,
  occurredAt,
  referral,
}: {
  db: DB;
  contactId: string;
  attribution: Attribution;
  occurredAt: Date;
  // Non-null in practice (an attribution implies a referral), but typed
  // loosely so the caller doesn't need an assertion to prove it.
  referral: WhatsAppReferral | null | undefined;
}): Promise<void> {
  const { error } = await db
    .from('contacts')
    .update({
      source: attribution.source,
      source_ad_id: attribution.adId,
      source_meta: referral,
      source_captured_at: safeIso(occurredAt),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('source', DEFAULT_SOURCE);

  if (error) console.error('[attribution] failed to stamp contact:', error);
}
