// ============================================================
// Rimula funnel / attribution analytics (§13, §23 Phase 7).
//
// Sits alongside `queries.ts` (the original wacrm dashboard
// aggregations) rather than inside it — this file is entirely
// Rimula-specific (funnel, campaign, product analytics), same split
// Phases 5/6 used for their own domains (`src/lib/routing/`,
// `src/lib/analytics/product-interaction.ts`).
//
// Same posture as `queries.ts`: plain client-side aggregation, RLS
// scopes every query to the caller's account automatically. Every
// number here is a real COUNT/aggregate over `engagement_events`,
// `product_interactions`, `customer_requests`, `deals`, `trials` —
// §2's "never fabricate" rule applies as much to a dashboard number
// as to a chat reply. Where a metric genuinely isn't derivable from
// the current schema (§13's REPEAT stage — there is no order/purchase
// history to detect a second purchase from), the field is `null` and
// callers render "Unavailable", never a guess or a silent 0.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CampaignAnalytics,
  FunnelMetrics,
  ProductAnalytics,
  ProductInteractionBreakdown,
} from './types';

type DB = SupabaseClient;

const ENGAGED_TYPES = ['READ', 'REACTION', 'REPLY', 'CLICK'] as const;

function distinctCount<T>(values: (T | null | undefined)[]): number {
  return new Set(values.filter((v): v is T => v != null)).size;
}

// --- 1. Account-wide funnel (Dashboard) --------------------------------

export async function loadFunnelMetrics(db: DB): Promise<FunnelMetrics> {
  const [eventsRes, activeMembersRes, interactionsRes, dealsRes, trialsRes] =
    await Promise.all([
      db.from('engagement_events').select('member_id, event_type'),
      db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('community_status', 'active'),
      db.from('product_interactions').select('contact_id'),
      db.from('deals').select('status'),
      db.from('trials').select('id', { count: 'exact', head: true }),
    ]);

  const events = (eventsRes.data ?? []) as {
    member_id: string | null;
    event_type: string;
  }[];
  const interactions = (interactionsRes.data ?? []) as {
    contact_id: string | null;
  }[];
  const deals = (dealsRes.data ?? []) as { status: string }[];

  const reach = distinctCount(
    events.filter((e) => e.event_type === 'DELIVERED').map((e) => e.member_id)
  );
  const engage = distinctCount(
    events
      .filter((e) =>
        (ENGAGED_TYPES as readonly string[]).includes(e.event_type)
      )
      .map((e) => e.member_id)
  );
  const productInterest = distinctCount(interactions.map((i) => i.contact_id));
  const leadCount = deals.length;
  // "BA contact" = a Lead has moved past the raw NEW state — some
  // human action (assignment, a call, a follow-up) has happened.
  const baContact = deals.filter((d) => d.status !== 'NEW').length;
  const purchase = deals.filter((d) => d.status === 'CONVERTED').length;

  return {
    stages: [
      { key: 'reach', value: reach },
      { key: 'join', value: activeMembersRes.count ?? 0 },
      { key: 'engage', value: engage },
      { key: 'productInterest', value: productInterest },
      { key: 'lead', value: leadCount },
      { key: 'baContact', value: baContact },
      { key: 'trial', value: trialsRes.count ?? 0 },
      { key: 'purchase', value: purchase },
      // No order/purchase-history table exists to detect a second
      // conversion by the same customer — never invent this number.
      { key: 'repeat', value: null },
    ],
  };
}

// --- 2. Campaign analytics (campaign detail page + Reports) -----------

interface CampaignRow {
  id: string;
  campaign_name: string;
  cost: number | null;
}

/**
 * Shared aggregator: given a set of already-fetched campaign rows
 * (one for the campaign detail page, all of them for Reports), computes
 * each campaign's reach/engagement/leads/trials/conversions/cost
 * metrics with one batch of queries scoped to those campaign ids —
 * not one query per campaign.
 */
async function aggregateCampaigns(
  db: DB,
  campaigns: CampaignRow[]
): Promise<CampaignAnalytics[]> {
  if (campaigns.length === 0) return [];
  const campaignIds = campaigns.map((c) => c.id);

  const [eventsRes, dealsRes, requestsRes] = await Promise.all([
    db
      .from('engagement_events')
      .select('member_id, event_type, campaign_id')
      .in('campaign_id', campaignIds),
    db
      .from('deals')
      .select('id, campaign_id, status')
      .in('campaign_id', campaignIds),
    db
      .from('customer_requests')
      .select('id, campaign_id')
      .in('campaign_id', campaignIds),
  ]);

  const events = (eventsRes.data ?? []) as {
    member_id: string | null;
    event_type: string;
    campaign_id: string;
  }[];
  const deals = (dealsRes.data ?? []) as {
    id: string;
    campaign_id: string;
    status: string;
  }[];
  const requests = (requestsRes.data ?? []) as {
    id: string;
    campaign_id: string;
  }[];

  // Trials carry no campaign_id of their own — they're reached via
  // the deal or customer_request they originated from/converted into
  // (§9.0/Phase 6). One more query, scoped to exactly the deal/request
  // ids just fetched above.
  const dealIds = deals.map((d) => d.id);
  const requestIds = requests.map((r) => r.id);
  let trials: { deal_id: string | null; customer_request_id: string | null }[] =
    [];
  if (dealIds.length > 0 || requestIds.length > 0) {
    const filters: string[] = [];
    if (dealIds.length > 0) filters.push(`deal_id.in.(${dealIds.join(',')})`);
    if (requestIds.length > 0)
      filters.push(`customer_request_id.in.(${requestIds.join(',')})`);
    const { data } = await db
      .from('trials')
      .select('deal_id, customer_request_id')
      .or(filters.join(','));
    trials = (data ?? []) as typeof trials;
  }

  const dealToCampaign = new Map(deals.map((d) => [d.id, d.campaign_id]));
  const requestToCampaign = new Map(requests.map((r) => [r.id, r.campaign_id]));

  return campaigns.map((c): CampaignAnalytics => {
    const campaignEvents = events.filter((e) => e.campaign_id === c.id);
    const campaignDeals = deals.filter((d) => d.campaign_id === c.id);
    const campaignTrialCount = trials.filter((t) => {
      const viaDeal = t.deal_id && dealToCampaign.get(t.deal_id) === c.id;
      const viaRequest =
        t.customer_request_id &&
        requestToCampaign.get(t.customer_request_id) === c.id;
      return viaDeal || viaRequest;
    }).length;

    const reach = distinctCount(
      campaignEvents
        .filter((e) => e.event_type === 'DELIVERED')
        .map((e) => e.member_id)
    );
    const engagement = distinctCount(
      campaignEvents
        .filter((e) =>
          (ENGAGED_TYPES as readonly string[]).includes(e.event_type)
        )
        .map((e) => e.member_id)
    );
    const leads = campaignDeals.length;
    const conversions = campaignDeals.filter(
      (d) => d.status === 'CONVERTED'
    ).length;

    const perX = (n: number) => (c.cost != null && n > 0 ? c.cost / n : null);

    return {
      campaignId: c.id,
      campaignName: c.campaign_name,
      reach,
      engagement,
      leads,
      trials: campaignTrialCount,
      conversions,
      cost: c.cost,
      costPerLead: perX(leads),
      costPerTrial: perX(campaignTrialCount),
      costPerConversion: perX(conversions),
    };
  });
}

export async function loadCampaignAnalytics(
  db: DB,
  campaignId: string
): Promise<CampaignAnalytics | null> {
  const { data } = await db
    .from('campaigns')
    .select('id, campaign_name, cost')
    .eq('id', campaignId)
    .maybeSingle();
  if (!data) return null;
  const [result] = await aggregateCampaigns(db, [data as CampaignRow]);
  return result ?? null;
}

export async function loadAllCampaignsAnalytics(
  db: DB
): Promise<CampaignAnalytics[]> {
  const { data } = await db
    .from('campaigns')
    .select('id, campaign_name, cost')
    .order('created_at', { ascending: false });
  return aggregateCampaigns(db, (data ?? []) as CampaignRow[]);
}

// --- 3. Product analytics (product detail page + Reports) -------------

const INTERACTION_TYPES = [
  'viewed',
  'clicked',
  'enquiry',
  'interest',
  'trial_request',
  'lead',
  'conversion',
] as const;

function emptyBreakdown(): ProductInteractionBreakdown {
  return {
    viewed: 0,
    clicked: 0,
    enquiry: 0,
    interest: 0,
    trial_request: 0,
    lead: 0,
    conversion: 0,
  };
}

interface ProductRow {
  id: string;
  product_name: string;
}

async function aggregateProducts(
  db: DB,
  products: ProductRow[]
): Promise<ProductAnalytics[]> {
  if (products.length === 0) return [];
  const productIds = products.map((p) => p.id);

  const [interactionsRes, requestsRes, trialsRes] = await Promise.all([
    db
      .from('product_interactions')
      .select('product_id, interaction_type')
      .in('product_id', productIds),
    db
      .from('customer_requests')
      .select('id, product_id')
      .in('product_id', productIds),
    db.from('trials').select('product_id, status').in('product_id', productIds),
  ]);

  const interactions = (interactionsRes.data ?? []) as {
    product_id: string;
    interaction_type: string;
  }[];
  const requests = (requestsRes.data ?? []) as {
    id: string;
    product_id: string;
  }[];
  const trials = (trialsRes.data ?? []) as {
    product_id: string;
    status: string;
  }[];

  return products.map((p): ProductAnalytics => {
    const breakdown = emptyBreakdown();
    for (const i of interactions) {
      if (i.product_id !== p.id) continue;
      if (
        (INTERACTION_TYPES as readonly string[]).includes(i.interaction_type)
      ) {
        breakdown[i.interaction_type as keyof ProductInteractionBreakdown] += 1;
      }
    }
    const productTrials = trials.filter((t) => t.product_id === p.id);
    return {
      productId: p.id,
      productName: p.product_name,
      interactions: breakdown,
      customerRequests: requests.filter((r) => r.product_id === p.id).length,
      trials: productTrials.length,
      conversions: productTrials.filter((t) => t.status === 'CONVERTED').length,
    };
  });
}

export async function loadProductAnalytics(
  db: DB,
  productId: string
): Promise<ProductAnalytics | null> {
  const { data } = await db
    .from('products')
    .select('id, product_name')
    .eq('id', productId)
    .maybeSingle();
  if (!data) return null;
  const [result] = await aggregateProducts(db, [data as ProductRow]);
  return result ?? null;
}

export async function loadAllProductsAnalytics(
  db: DB
): Promise<ProductAnalytics[]> {
  const { data } = await db
    .from('products')
    .select('id, product_name')
    .order('updated_at', { ascending: false });
  return aggregateProducts(db, (data ?? []) as ProductRow[]);
}
