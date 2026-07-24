/**
 * Resolve a tracked-link ref code found on an inbound message and
 * record the attribution touch. Kept separate from capture.ts so the
 * webhook route only needs one call and never touches `tracked_links`
 * or `ad_campaigns` directly.
 *
 * Only called when the message carries no Meta `referral` — a Meta
 * referral is ground truth from the platform itself and always wins
 * over a customer-editable text tag.
 */

import { extractRefCode } from './ref-token';
import { recordTrackedLinkTouch, type Attribution } from './capture';
import { toContactSource } from './sources';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export interface CaptureTrackedLinkArgs {
  db: DB;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  wamid?: string | null;
  /** The inbound message's text body, if any. */
  text: string | null | undefined;
  occurredAt?: Date;
}

/**
 * Look for a `[#code]` tag in the message text, resolve it to a
 * tracked link, and record the touch. No-op (and no DB query at all)
 * when the text carries no tag — the overwhelmingly common case.
 */
export async function captureTrackedLinkTouch({
  db,
  accountId,
  contactId,
  conversationId = null,
  wamid = null,
  text,
  occurredAt = new Date(),
}: CaptureTrackedLinkArgs): Promise<Attribution | null> {
  const code = extractRefCode(text);
  if (!code) return null;

  const { data: link, error } = await db
    .from('tracked_links')
    .select('id, account_id, source, campaign_id')
    .eq('slug', code)
    .maybeSingle();

  if (error) {
    console.error('[attribution] tracked-link lookup failed:', error);
    return null;
  }
  if (!link) return null;

  // A code that matches a DIFFERENT account's link — most likely a
  // customer forwarded a link meant for someone else's WhatsApp
  // number. Crediting it here would attribute the lead to the wrong
  // tenant's campaign; silently skip instead.
  if (link.account_id !== accountId) return null;

  let campaignExternalId: string | null = null;
  if (link.campaign_id) {
    const { data: campaign } = await db
      .from('ad_campaigns')
      .select('external_id')
      .eq('id', link.campaign_id)
      .maybeSingle();
    campaignExternalId = (campaign as { external_id?: string } | null)?.external_id ?? null;
  }

  return recordTrackedLinkTouch({
    db,
    accountId,
    contactId,
    conversationId,
    wamid,
    link: {
      source: toContactSource(link.source),
      slug: code,
      campaignExternalId,
    },
    occurredAt,
  });
}
