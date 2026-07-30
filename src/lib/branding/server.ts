import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND_TITLE, resolveBrand, type Brand } from "./brand";

/**
 * Server-side branding read, used by the dashboard layout's
 * `generateMetadata` to put the account's name and logo into the
 * browser tab.
 *
 * Three deliberate differences from `getCurrentAccount`
 * (src/lib/auth/account.ts), which is the obvious thing to reach for
 * and the wrong tool here:
 *
 * 1. THIS NEVER THROWS. `getCurrentAccount` raises ForbiddenError when
 *    the account select fails, which is correct for an API route that
 *    must refuse to act. Metadata is decoration: a failure here should
 *    cost the user their logo for one render, not a broken page. Every
 *    failure path returns the generic brand.
 *
 * 2. No `auth.getUser()`. That is a network round trip to the auth
 *    server, and it is not the security boundary here — RLS is. With a
 *    missing or forged JWT the query below returns no rows and we fall
 *    back. The middleware (src/middleware.ts:26) has already refreshed
 *    the session cookie before this runs.
 *
 * 3. No lookup through `profiles`. The `accounts_select` policy is
 *    `USING (is_account_member(id))` (migration 017), so an unfiltered
 *    select on `accounts` already returns exactly the caller's row —
 *    Postgres does the join that would otherwise be a second round
 *    trip.
 *
 * Net cost: one query per request, deduped within a request by
 * React's `cache`.
 */

const GENERIC_BRAND: Brand = {
  title: DEFAULT_BRAND_TITLE,
  logoUrl: null,
  isCustom: false,
};

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const supabase = await createClient();

    // No embedded FK join (`accounts!inner(...)`): a stale PostgREST
    // schema cache makes embeds fail hard with PGRST200, which is how
    // issue #294 blanked the account context. A flat select needs no
    // relationship inference. There is a test asserting the select
    // string contains no "(".
    //
    // `limit(2)` rather than `single()`: if RLS ever returned more
    // than one row we want to notice and fall back, not throw.
    const { data, error } = await supabase
      .from("accounts")
      .select("brand_name, logo_url")
      .limit(2);

    if (error || !data || data.length !== 1) return GENERIC_BRAND;

    return resolveBrand(data[0]);
  } catch {
    // Covers a missing cookie store, an unreachable database, and the
    // migration-not-yet-applied window where `brand_name` is not in
    // the schema cache.
    return GENERIC_BRAND;
  }
});
