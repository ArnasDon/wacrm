import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fixed sales-funnel stages (migration 030). Unlike `pipeline_stages`,
 * these are not user-configurable yet — every account gets the same
 * list, lazily seeded into `funnel_stages` the first time it's needed
 * (either an inbound message via `enterFunnelIfNew`, or the /kanban
 * page load — whichever happens first for a given account).
 *
 * `key` is the stable machine name the rest of the app keys off of
 * (e.g. picking "the first stage" for a brand-new lead); `position`
 * is what the board sorts columns by.
 */
export const DEFAULT_FUNNEL_STAGES = [
  { key: "new_lead", name: "New Lead", color: "#3b82f6", position: 0 },
  { key: "engaged", name: "Engaged", color: "#06b6d4", position: 1 },
  { key: "qualified", name: "Qualified", color: "#eab308", position: 2 },
  { key: "negotiating", name: "Negotiating", color: "#f97316", position: 3 },
  { key: "customer", name: "Customer", color: "#22c55e", position: 4 },
  { key: "cold", name: "Cold / Lost", color: "#64748b", position: 5 },
] as const;

// Stalled-lead signal: a card sitting in the same stage past this
// threshold gets flagged — on the Kanban card (aging badge) and in the
// "Stalled Leads" dashboard metric alike, so both surfaces agree on
// what "cooling off" means.
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export interface FunnelStageRow {
  id: string;
  account_id: string;
  key: string;
  name: string;
  position: number;
  color: string;
  created_at: string;
}

/**
 * Returns `accountId`'s funnel stages, ordered by position — seeding
 * the default list first if the account has none yet. Safe to call
 * from either the webhook (service-role client) or the browser client
 * (agent+ per the `funnel_stages_insert` RLS policy).
 */
export async function ensureFunnelStages(
  db: SupabaseClient,
  accountId: string,
): Promise<FunnelStageRow[]> {
  const { data: existing } = await db
    .from("funnel_stages")
    .select("*")
    .eq("account_id", accountId)
    .order("position");

  if (existing && existing.length > 0) return existing as FunnelStageRow[];

  const payload = DEFAULT_FUNNEL_STAGES.map((s) => ({
    account_id: accountId,
    key: s.key,
    name: s.name,
    color: s.color,
    position: s.position,
  }));

  const { error } = await db.from("funnel_stages").insert(payload);
  if (error) {
    // Lost a race against a concurrent seed attempt (e.g. two inbound
    // messages for a brand-new account at once) — the (account_id, key)
    // unique index rejected the duplicate. Re-select the winner's rows.
    const { data: raced } = await db
      .from("funnel_stages")
      .select("*")
      .eq("account_id", accountId)
      .order("position");
    if (raced && raced.length > 0) return raced as FunnelStageRow[];
    console.error("[funnel-stages] failed to seed default stages:", error.message);
    return [];
  }

  const { data: seeded } = await db
    .from("funnel_stages")
    .select("*")
    .eq("account_id", accountId)
    .order("position");
  return (seeded ?? []) as FunnelStageRow[];
}
