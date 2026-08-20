// ============================================================
// ProductInteraction writer — §13's PRODUCT -> CAMPAIGN -> CONTENT ->
// CUSTOMER -> LEAD -> TRIAL -> CONVERSION attribution trail
// (`product_interactions`, migration 047). Same posture as
// `writeEngagementEvent` (`src/lib/whatsapp/engagement.ts`): one
// writer, called from inside the existing create/status-transition
// handlers rather than a parallel ingestion path, best-effort so a
// write failure never breaks the request it's attached to.
//
// `product_interactions` has no client INSERT policy (migration 047
// header) — callers must pass a service-role client, same convention
// as `writeEngagementEvent`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductInteractionType =
  | 'viewed'
  | 'clicked'
  | 'enquiry'
  | 'interest'
  | 'trial_request'
  | 'lead'
  | 'conversion';

export interface WriteProductInteractionInput {
  accountId: string;
  contactId: string | null;
  productId: string | null;
  campaignId?: string | null;
  contentId?: string | null;
  interactionType: ProductInteractionType;
}

/**
 * Append one row to `product_interactions`. No-ops (doesn't even
 * attempt the insert) when `productId` is null — every row in this
 * table is a (contact, product) touch, so there's nothing meaningful
 * to record without a product.
 */
export async function writeProductInteraction(
  db: SupabaseClient,
  input: WriteProductInteractionInput
): Promise<void> {
  if (!input.productId) return;
  try {
    const { error } = await db.from('product_interactions').insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      product_id: input.productId,
      campaign_id: input.campaignId ?? null,
      content_id: input.contentId ?? null,
      interaction_type: input.interactionType,
    });
    if (error) {
      console.error('[product-interaction] write failed:', error.message);
    }
  } catch (err) {
    console.error(
      '[product-interaction] write threw:',
      err instanceof Error ? err.message : err
    );
  }
}
