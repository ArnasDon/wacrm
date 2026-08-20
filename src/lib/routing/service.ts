// ============================================================
// LeadRoutingService — the §2 provider abstraction for §12's
// "Market BA -> Regional BA -> Unassigned" routing.
//
// One entry point (`routeAssignment`), called from the create-side of
// every assignable table Phase 6 introduces (`customer_requests`,
// `deals` as Lead, `trials`) and from their reassignment endpoints.
// No route imports the strategy logic directly — mirrors the
// WhatsAppService pattern (`src/lib/whatsapp/service.ts`): business
// logic depends on this module's exported functions, never on a raw
// `profiles` query written inline at the call site.
//
// Candidate resolution
// ---------------------
//   1. Market BA   — active BAs whose `market_id` matches the item's
//      market, if one is known.
//   2. Regional BA — active BAs whose `region_id` matches the item's
//      region, if step 1 found nobody.
//   3. Unassigned   — no active BA in either scope; the item is left
//      for an admin to route by hand. Never invents a match (§2).
//
// Strategy (per-account, `ba_routing_settings.strategy`, §15)
// -------------------------------------------------------------
//   - round_robin       — cycles through candidates using the
//     account's persisted `round_robin_cursor` (migration 056's
//     `advance_ba_routing_cursor` RPC), so consecutive routing calls
//     for the same account fairly rotate rather than always picking
//     candidate #1.
//   - lowest_open_leads — picks the candidate with the fewest open
//     leads; ties broken by lowest `capacity` utilisation ratio, then
//     `user_id` for determinism. BAs at or over capacity are skipped
//     when at least one candidate still has headroom.
//   - manual            — never auto-assigns; always returns
//     Unassigned so a human makes every call. This is the default an
//     account can opt into from Settings, not a fallback for missing
//     config (missing config defaults to `lowest_open_leads`, see
//     `loadRoutingStrategy`).
//
// Every decision's `reason` string is persisted onto the assigned
// row's own `routing_reason` column (§12: "Record why a BA was
// chosen") rather than a separate audit table — see migration 056's
// header for why.
//
// `open_leads` bookkeeping goes through the `adjust_ba_open_leads`
// RPC (migration 056) so the counter update is atomic and RLS-safe
// regardless of which account member's session is doing the routing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type RoutingStrategy = 'round_robin' | 'lowest_open_leads' | 'manual';

export interface RouteAssignmentInput {
  accountId: string;
  marketId: string | null;
  regionId: string | null;
}

export interface RoutingDecision {
  assignedBaId: string | null;
  reason: string;
}

interface CandidateBa {
  user_id: string;
  open_leads: number;
  capacity: number;
}

/**
 * Read the account's configured strategy, defaulting to
 * `lowest_open_leads` when no `ba_routing_settings` row exists yet
 * (an account that has never opened Settings still gets sane
 * auto-routing rather than silently doing nothing).
 */
export async function loadRoutingStrategy(
  db: SupabaseClient,
  accountId: string
): Promise<RoutingStrategy> {
  const { data } = await db
    .from('ba_routing_settings')
    .select('strategy')
    .eq('account_id', accountId)
    .maybeSingle();
  return (data?.strategy as RoutingStrategy | undefined) ?? 'lowest_open_leads';
}

async function findCandidates(
  db: SupabaseClient,
  accountId: string,
  scopeColumn: 'market_id' | 'region_id',
  scopeId: string
): Promise<CandidateBa[]> {
  const { data, error } = await db
    .from('profiles')
    .select('user_id, open_leads, capacity')
    .eq('account_id', accountId)
    .eq('ba_status', 'active')
    .eq(scopeColumn, scopeId);
  if (error) {
    console.error('[routing] candidate lookup failed:', error.message);
    return [];
  }
  return (data ?? []) as CandidateBa[];
}

function pickLowestOpenLeads(candidates: CandidateBa[]): CandidateBa {
  const withHeadroom = candidates.filter((c) => c.open_leads < c.capacity);
  const pool = withHeadroom.length > 0 ? withHeadroom : candidates;
  return [...pool].sort((a, b) => {
    if (a.open_leads !== b.open_leads) return a.open_leads - b.open_leads;
    const aRatio = a.capacity > 0 ? a.open_leads / a.capacity : Infinity;
    const bRatio = b.capacity > 0 ? b.open_leads / b.capacity : Infinity;
    if (aRatio !== bRatio) return aRatio - bRatio;
    return a.user_id.localeCompare(b.user_id);
  })[0];
}

async function pickRoundRobin(
  db: SupabaseClient,
  accountId: string,
  candidates: CandidateBa[]
): Promise<CandidateBa> {
  const sorted = [...candidates].sort((a, b) =>
    a.user_id.localeCompare(b.user_id)
  );
  const { data: cursor, error } = await db.rpc('advance_ba_routing_cursor', {
    p_account_id: accountId,
  });
  if (error || typeof cursor !== 'number') {
    console.error(
      '[routing] round-robin cursor RPC failed, falling back to first candidate:',
      error?.message
    );
    return sorted[0];
  }
  return sorted[cursor % sorted.length];
}

/**
 * Resolve who a new item (CustomerRequest / Lead / Trial) should be
 * assigned to, per §12's Market -> Regional -> Unassigned cascade.
 * Does NOT write anything — callers persist `assignedBaId` +
 * `reason` onto their own row and then call {@link commitAssignment}.
 */
export async function routeAssignment(
  db: SupabaseClient,
  input: RouteAssignmentInput
): Promise<RoutingDecision> {
  const strategy = await loadRoutingStrategy(db, input.accountId);

  if (strategy === 'manual') {
    return {
      assignedBaId: null,
      reason: 'Manual routing strategy — awaiting admin assignment',
    };
  }

  let scope: 'market' | 'region' | null = null;
  let candidates: CandidateBa[] = [];

  if (input.marketId) {
    candidates = await findCandidates(
      db,
      input.accountId,
      'market_id',
      input.marketId
    );
    if (candidates.length > 0) scope = 'market';
  }
  if (candidates.length === 0 && input.regionId) {
    candidates = await findCandidates(
      db,
      input.accountId,
      'region_id',
      input.regionId
    );
    if (candidates.length > 0) scope = 'region';
  }

  if (candidates.length === 0) {
    return {
      assignedBaId: null,
      reason:
        input.marketId || input.regionId
          ? 'No active BA covers this market or region — routed to Unassigned queue'
          : 'No market or region on record — routed to Unassigned queue',
    };
  }

  const picked =
    strategy === 'round_robin'
      ? await pickRoundRobin(db, input.accountId, candidates)
      : pickLowestOpenLeads(candidates);

  return {
    assignedBaId: picked.user_id,
    reason: `Matched ${scope} BA via ${strategy} (${picked.open_leads}/${picked.capacity} open leads)`,
  };
}

/**
 * `CustomerRequest` and `Trial` have no `market_id`/`region_id` of
 * their own (§9.1 doesn't list them — only `Member`/`BA`/`Lead` carry
 * a market/region). When a request/trial is linked to a `Member`
 * (`contacts`), route using THAT member's market/region rather than
 * leaving every non-Lead item Unassigned. Returns nulls (routes to
 * Unassigned) when there's no linked contact or it carries neither.
 */
export async function resolveMarketRegionFromContact(
  db: SupabaseClient,
  contactId: string | null
): Promise<{ marketId: string | null; regionId: string | null }> {
  if (!contactId) return { marketId: null, regionId: null };
  const { data, error } = await db
    .from('contacts')
    .select('market_id, region_id')
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return { marketId: null, regionId: null };
  return { marketId: data.market_id ?? null, regionId: data.region_id ?? null };
}

/**
 * Apply the `open_leads` delta for an assignment change. Call with
 * `previousBaId: null, nextBaId: <id>` on first assignment,
 * `previousBaId: <id>, nextBaId: null` on unassignment/closure, or
 * both set on a reassignment (decrements the old BA, increments the
 * new one). No-ops when previous === next.
 */
export async function commitAssignment(
  db: SupabaseClient,
  params: { previousBaId: string | null; nextBaId: string | null }
): Promise<void> {
  const { previousBaId, nextBaId } = params;
  if (previousBaId === nextBaId) return;

  if (previousBaId) {
    const { error } = await db.rpc('adjust_ba_open_leads', {
      p_user_id: previousBaId,
      p_delta: -1,
    });
    if (error)
      console.error('[routing] failed to decrement open_leads:', error.message);
  }
  if (nextBaId) {
    const { error } = await db.rpc('adjust_ba_open_leads', {
      p_user_id: nextBaId,
      p_delta: 1,
    });
    if (error)
      console.error('[routing] failed to increment open_leads:', error.message);
  }
}
