import { describe, expect, it } from 'vitest';
import {
  loadFunnelMetrics,
  loadCampaignAnalytics,
  loadAllCampaignsAnalytics,
  loadProductAnalytics,
  loadAllProductsAnalytics,
} from './rimula-analytics';

// ------------------------------------------------------------
// A small generic fake query builder. Each table is a fixed array of
// rows; `.eq()`/`.in()` narrow it, `.or()` is honored for the exact
// `col.in.(...)` shape aggregateCampaigns emits, `.order()` is a
// no-op (aggregation doesn't depend on row order), and the object is
// itself awaitable (`then`) so `await db.from(...).select(...)`
// resolves directly, matching every call site in rimula-analytics.ts.
// ------------------------------------------------------------

type Row = Record<string, unknown>;

function makeSupabase(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const rows = tables[table] ?? [];
      const query = {
        _rows: rows,
        _headCount: false,
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) this._headCount = true;
          return this;
        },
        eq(col: string, val: unknown) {
          this._rows = this._rows.filter((r) => r[col] === val);
          return this;
        },
        in(col: string, vals: unknown[]) {
          this._rows = this._rows.filter((r) => vals.includes(r[col]));
          return this;
        },
        or(expr: string) {
          // expr looks like "deal_id.in.(a,b),customer_request_id.in.(c,d)"
          const clauses = expr
            .split('),')
            .map((c) => (c.endsWith(')') ? c : c + ')'));
          this._rows = this._rows.filter((r) =>
            clauses.some((clause) => {
              const m = clause.match(/^(\w+)\.in\.\(([^)]*)\)$/);
              if (!m) return false;
              const [, col, list] = m;
              const vals = list.split(',').filter(Boolean);
              return vals.includes(String(r[col]));
            })
          );
          return this;
        },
        order() {
          return this;
        },
        async maybeSingle() {
          return { data: this._rows[0] ?? null, error: null };
        },
        then(resolve: (v: unknown) => void) {
          if (this._headCount) {
            resolve({ data: null, count: this._rows.length, error: null });
          } else {
            resolve({ data: this._rows, error: null });
          }
        },
      };
      return query;
    },
  };
}

describe('loadFunnelMetrics', () => {
  it('computes every stage from real rows, and REPEAT stays Unavailable (null)', async () => {
    const db = makeSupabase({
      engagement_events: [
        { member_id: 'm1', event_type: 'DELIVERED' },
        { member_id: 'm2', event_type: 'DELIVERED' },
        { member_id: 'm1', event_type: 'READ' },
        { member_id: 'm1', event_type: 'REACTION' },
      ],
      contacts: [{ id: 'c1', community_status: 'active' }],
      product_interactions: [
        { contact_id: 'm1' },
        { contact_id: 'm1' },
        { contact_id: 'm2' },
      ],
      deals: [
        { status: 'NEW' },
        { status: 'CONTACTED' },
        { status: 'CONVERTED' },
      ],
      trials: [{ id: 't1' }, { id: 't2' }],
    });

    const result = await loadFunnelMetrics(db as never);
    const byKey = Object.fromEntries(
      result.stages.map((s) => [s.key, s.value])
    );

    expect(byKey.reach).toBe(2); // distinct m1, m2 DELIVERED
    expect(byKey.join).toBe(1); // contacts count() head
    expect(byKey.engage).toBe(1); // distinct m1 READ/REACTION
    expect(byKey.productInterest).toBe(2); // distinct m1, m2
    expect(byKey.lead).toBe(3); // all deals
    expect(byKey.baContact).toBe(2); // status != NEW
    expect(byKey.trial).toBe(2);
    expect(byKey.purchase).toBe(1); // CONVERTED
    expect(byKey.repeat).toBeNull();
  });

  it('never throws on an all-empty account (no seed data yet)', async () => {
    const db = makeSupabase({});
    const result = await loadFunnelMetrics(db as never);
    for (const stage of result.stages) {
      if (stage.key === 'repeat') {
        expect(stage.value).toBeNull();
      } else {
        expect(stage.value).toBe(0);
      }
    }
  });
});

describe('loadCampaignAnalytics / loadAllCampaignsAnalytics', () => {
  const tables = {
    campaigns: [
      { id: 'camp-1', campaign_name: 'Winter Push', cost: 1000 },
      { id: 'camp-2', campaign_name: 'No Cost Campaign', cost: null },
    ],
    engagement_events: [
      { member_id: 'm1', event_type: 'DELIVERED', campaign_id: 'camp-1' },
      { member_id: 'm2', event_type: 'DELIVERED', campaign_id: 'camp-1' },
      { member_id: 'm1', event_type: 'READ', campaign_id: 'camp-1' },
      { member_id: 'm3', event_type: 'DELIVERED', campaign_id: 'camp-2' },
    ],
    deals: [
      { id: 'deal-1', campaign_id: 'camp-1', status: 'CONVERTED' },
      { id: 'deal-2', campaign_id: 'camp-1', status: 'NEW' },
      { id: 'deal-3', campaign_id: 'camp-2', status: 'NEW' },
    ],
    customer_requests: [{ id: 'cr-1', campaign_id: 'camp-1' }],
    trials: [
      { deal_id: 'deal-1', customer_request_id: null },
      { deal_id: null, customer_request_id: 'cr-1' },
      { deal_id: 'deal-3', customer_request_id: null },
    ],
  };

  it('scopes reach/engagement/leads/trials/conversions to the right campaign', async () => {
    const db = makeSupabase(tables);
    const result = await loadCampaignAnalytics(db as never, 'camp-1');

    expect(result).toMatchObject({
      campaignId: 'camp-1',
      reach: 2, // m1, m2
      engagement: 1, // m1 READ
      leads: 2, // deal-1, deal-2
      trials: 2, // deal-1's trial + cr-1's trial
      conversions: 1, // deal-1
      cost: 1000,
    });
    expect(result?.costPerLead).toBe(500); // 1000 / 2
    expect(result?.costPerTrial).toBe(500); // 1000 / 2
    expect(result?.costPerConversion).toBe(1000); // 1000 / 1
  });

  it('leaves every cost-per-X field null when the campaign has no cost data (§13)', async () => {
    const db = makeSupabase(tables);
    const result = await loadCampaignAnalytics(db as never, 'camp-2');

    expect(result?.cost).toBeNull();
    expect(result?.costPerLead).toBeNull();
    expect(result?.costPerTrial).toBeNull();
    expect(result?.costPerConversion).toBeNull();
    expect(result?.leads).toBe(1); // deal-3 only
    expect(result?.trials).toBe(1); // deal-3's trial only, not cr-1's
  });

  it('returns null for a campaign that does not exist', async () => {
    const db = makeSupabase(tables);
    const result = await loadCampaignAnalytics(db as never, 'nope');
    expect(result).toBeNull();
  });

  it('loadAllCampaignsAnalytics returns one row per campaign with no cross-contamination', async () => {
    const db = makeSupabase(tables);
    const results = await loadAllCampaignsAnalytics(db as never);
    expect(results).toHaveLength(2);
    const camp1 = results.find((r) => r.campaignId === 'camp-1');
    const camp2 = results.find((r) => r.campaignId === 'camp-2');
    expect(camp1?.leads).toBe(2);
    expect(camp2?.leads).toBe(1);
  });

  it('does not query child tables at all when the account has no campaigns', async () => {
    const db = makeSupabase({ campaigns: [] });
    const results = await loadAllCampaignsAnalytics(db as never);
    expect(results).toEqual([]);
  });
});

describe('loadProductAnalytics / loadAllProductsAnalytics', () => {
  const tables = {
    products: [
      { id: 'prod-1', product_name: 'Rimula R6' },
      { id: 'prod-2', product_name: 'Rimula R4' },
    ],
    product_interactions: [
      { product_id: 'prod-1', interaction_type: 'viewed' },
      { product_id: 'prod-1', interaction_type: 'viewed' },
      { product_id: 'prod-1', interaction_type: 'enquiry' },
      { product_id: 'prod-2', interaction_type: 'clicked' },
    ],
    customer_requests: [
      { id: 'cr-1', product_id: 'prod-1' },
      { id: 'cr-2', product_id: 'prod-1' },
    ],
    trials: [
      { product_id: 'prod-1', status: 'CONVERTED' },
      { product_id: 'prod-1', status: 'REQUESTED' },
      { product_id: 'prod-2', status: 'REQUESTED' },
    ],
  };

  it('breaks interactions down by type, scoped to the right product', async () => {
    const db = makeSupabase(tables);
    const result = await loadProductAnalytics(db as never, 'prod-1');

    expect(result?.interactions).toMatchObject({
      viewed: 2,
      enquiry: 1,
      clicked: 0,
    });
    expect(result?.customerRequests).toBe(2);
    expect(result?.trials).toBe(2);
    expect(result?.conversions).toBe(1);
  });

  it('loadAllProductsAnalytics covers every product independently', async () => {
    const db = makeSupabase(tables);
    const results = await loadAllProductsAnalytics(db as never);
    expect(results).toHaveLength(2);
    const p2 = results.find((r) => r.productId === 'prod-2');
    expect(p2?.interactions.clicked).toBe(1);
    expect(p2?.trials).toBe(1);
    expect(p2?.conversions).toBe(0);
  });
});
