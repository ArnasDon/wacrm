// ============================================================
// Content Studio audience resolution.
//
// A scheduled content post targets an audience by Member role/market
// rather than an explicit recipient list (unlike the existing
// Broadcasts wizard, which resolves tags/CSV client-side before
// calling the API — Content Studio's audience is coarser: "every
// confirmed Mechanic", not a hand-picked list). Both the "schedule"
// route (resolves once, to size the audience for the confirmation UI)
// and the cron drain (resolves again at send time, so a Member who
// joined between scheduling and sending is included) call this same
// function — one definition of "who does this post reach", not two
// that could drift.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AudienceSelector {
  /** Member roles to include. Omitted/empty = every role. */
  roles?: string[];
  /** Market ids to include, or ['all'] / omitted for every market. */
  markets?: string[];
}

export interface AudienceContact {
  id: string;
  phone: string;
}

/**
 * Resolve an {@link AudienceSelector} into the Members it currently
 * matches. Only WhatsApp-confirmed, opted-in contacts are included —
 * sending to an unconfirmed number is exactly the failure mode
 * `whatsapp_status`/`opt_in_status` (migration 050) exist to prevent.
 */
export async function resolveAudienceContacts(
  db: SupabaseClient,
  accountId: string,
  selector: AudienceSelector
): Promise<AudienceContact[]> {
  let query = db
    .from('contacts')
    .select('id, phone')
    .eq('account_id', accountId)
    .eq('whatsapp_status', 'confirmed')
    .eq('opt_in_status', 'opted_in')
    .not('phone', 'is', null);

  if (selector.roles && selector.roles.length > 0) {
    query = query.in('role', selector.roles);
  }
  if (
    selector.markets &&
    selector.markets.length > 0 &&
    !selector.markets.includes('all')
  ) {
    query = query.in('market_id', selector.markets);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to resolve audience: ${error.message}`);
  }
  return (data ?? []).filter(
    (c): c is AudienceContact =>
      typeof c.phone === 'string' && c.phone.length > 0
  );
}
