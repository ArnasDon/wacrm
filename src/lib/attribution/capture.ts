/**
 * Capture where an inbound WhatsApp lead came from.
 *
 * Two sources feed this, both first-touch:
 *
 *   - Meta attaches a `referral` object to the first message a
 *     customer sends after tapping a Click-to-WhatsApp ad. It is the
 *     only moment the ad is ever named — it does not repeat on later
 *     messages, and nothing else in the API links a phone number back
 *     to an ad. Miss it and the lead is indistinguishable from a
 *     walk-in forever. The campaign isn't known yet at this point —
 *     only the ad id; the ads sync (src/lib/ads/sync.ts) resolves it
 *     later against the Marketing API.
 *
 *   - A tracked link (migration 040) for platforms with no referral
 *     of their own — Google Ads, a landing page, a printed flyer. The
 *     customer's WhatsApp opens with a pre-filled message carrying a
 *     short opaque code; the webhook looks for it when there's no
 *     Meta referral. Unlike Meta, the campaign is known immediately
 *     (the operator picked it when creating the link), so no async
 *     resolution step is needed for this path.
 *
 * Two writes per touch either way (see migration 037 for why both
 * exist):
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
  /**
   * Meta's external campaign id (or a manual campaign's operator-chosen
   * external_id) — matches `ad_campaigns.external_id`. Null for a Meta
   * referral (unresolved until the ads sync runs); known immediately
   * for a tracked link.
   */
  campaignExternalId: string | null;
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
    campaignExternalId: null,
    ctwaClid,
    headline: clean(referral.headline),
    sourceUrl: clean(referral.source_url),
  };
}

/** The tracked-link row this module needs — see migration 040. */
export interface TrackedLinkRef {
  source: ContactSource;
  slug: string;
  /** external_id of the ad_campaigns row it's linked to, if any. */
  campaignExternalId: string | null;
}

/**
 * Map a resolved tracked link to what we store. Always succeeds (a
 * caller only reaches this after already finding the link by slug) —
 * unlike referralToAttribution there's no "nothing worth recording"
 * case, since the tag matching alone already means a deliberate click.
 */
export function trackedLinkToAttribution(link: TrackedLinkRef): Attribution {
  return {
    source: link.source,
    adId: null,
    campaignExternalId: link.campaignExternalId,
    ctwaClid: null,
    headline: null,
    sourceUrl: `/l/${link.slug}`,
  };
}

/** Minimal shape of the Supabase client this module needs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

interface RecordTouchArgs {
  db: DB;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  /** WhatsApp message id — the idempotency key for webhook retries. */
  wamid?: string | null;
  attribution: Attribution;
  /** Stored verbatim in attribution_events.raw for debugging. */
  raw: unknown;
  /** When the message arrived. Defaults to now. */
  occurredAt?: Date;
}

/**
 * Shared writer for both attribution paths: append the event log row
 * (idempotent on wamid) then stamp first-touch columns on the contact.
 */
async function recordAttributionTouch({
  db,
  accountId,
  contactId,
  conversationId = null,
  wamid = null,
  attribution,
  raw,
  occurredAt = new Date(),
}: RecordTouchArgs): Promise<Attribution> {
  const { error } = await db.from('attribution_events').insert({
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId,
    wamid,
    source: attribution.source,
    ad_id: attribution.adId,
    campaign_id: attribution.campaignExternalId,
    ctwa_clid: attribution.ctwaClid,
    headline: attribution.headline,
    source_url: attribution.sourceUrl,
    raw,
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

  await stampFirstTouch({ db, contactId, attribution, occurredAt, raw });
  return attribution;
}

export interface RecordReferralTouchArgs {
  db: DB;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  wamid?: string | null;
  referral: WhatsAppReferral | null | undefined;
  occurredAt?: Date;
}

/**
 * Record one Meta-ad attribution touch. Safe to call for every
 * inbound message: messages without a referral (the vast majority)
 * return immediately without touching the database.
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
}: RecordReferralTouchArgs): Promise<Attribution | null> {
  const attribution = referralToAttribution(referral);
  if (!attribution) return null;

  return recordAttributionTouch({
    db,
    accountId,
    contactId,
    conversationId,
    wamid,
    attribution,
    raw: referral,
    occurredAt,
  });
}

export interface RecordTrackedLinkTouchArgs {
  db: DB;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  wamid?: string | null;
  link: TrackedLinkRef;
  occurredAt?: Date;
}

/** Record one tracked-link attribution touch (Google Ads, web, organic). */
export async function recordTrackedLinkTouch({
  db,
  accountId,
  contactId,
  conversationId = null,
  wamid = null,
  link,
  occurredAt = new Date(),
}: RecordTrackedLinkTouchArgs): Promise<Attribution> {
  const attribution = trackedLinkToAttribution(link);
  return recordAttributionTouch({
    db,
    accountId,
    contactId,
    conversationId,
    wamid,
    attribution,
    raw: { tracked_link_slug: link.slug },
    occurredAt,
  });
}

/**
 * Write the first-touch columns, and only if the contact is still
 * unclassified.
 *
 * The `.eq('source', DEFAULT_SOURCE)` filter is the whole guard, and
 * it lives in the WHERE clause on purpose: a read-then-write would
 * race two concurrent inbound deliveries and could let the second
 * touch overwrite the first one's credit. Postgres settles it for us.
 */
async function stampFirstTouch({
  db,
  contactId,
  attribution,
  occurredAt,
  raw,
}: {
  db: DB;
  contactId: string;
  attribution: Attribution;
  occurredAt: Date;
  raw: unknown;
}): Promise<void> {
  const { error } = await db
    .from('contacts')
    .update({
      source: attribution.source,
      source_ad_id: attribution.adId,
      source_campaign_id: attribution.campaignExternalId,
      source_meta: raw,
      source_captured_at: safeIso(occurredAt),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('source', DEFAULT_SOURCE);

  if (error) console.error('[attribution] failed to stamp contact:', error);
}
