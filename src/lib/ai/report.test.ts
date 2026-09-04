import { describe, it, expect } from 'vitest';
import { shapeReport } from './report';
import type { KpiDataset } from '@/lib/kpis/types';

function dataset(over: Partial<KpiDataset> = {}): KpiDataset {
  return {
    granularity: 'week',
    window: { start: new Date('2026-08-01'), end: new Date('2026-08-31') },
    previousWindow: { start: new Date('2026-07-01'), end: new Date('2026-07-31') },
    leads: [
      { id: 'l1', created_at: '2026-08-02', lead_temperature: 'hot' },
      { id: 'l2', created_at: '2026-08-05', lead_temperature: 'warm' },
      { id: 'l3', created_at: '2026-08-09', lead_temperature: 'cold' },
      { id: 'l4', created_at: '2026-08-11', lead_temperature: null },
    ],
    previousLeadsCount: 2,
    wonDeals: [
      { id: 'd1', won_at: '2026-08-12', updated_at: '2026-08-12', value: 1500, currency: 'GTQ' },
      { id: 'd2', won_at: '2026-08-20', updated_at: '2026-08-20', value: 500, currency: 'GTQ' },
    ],
    previousWonCount: 1,
    temperature: { hot: 1, warm: 1, cold: 1, unclassified: 1 },
    spendHistory: [],
    currentPeriodSpend: null,
    trial: {
      conversationsActive: 10,
      conversationsAnswered: 8,
      medianFirstResponseMin: 12,
      prevMedianFirstResponseMin: 20,
      followupsSent: 4,
      prevFollowupsSent: 1,
      opportunitiesRecovered: 2,
      handoffs: 3,
      handoffsAdvanced: 1,
      briefCompletionPct: 66.6667,
    },
    ...over,
  };
}

describe('shapeReport', () => {
  it('flattens a KpiDataset into plain report numbers', () => {
    const r = shapeReport(dataset(), 30);
    expect(r).toMatchObject({
      period_days: 30,
      from: '2026-08-01',
      to: '2026-08-31',
      leads_generated: 4,
      leads_generated_prev: 2,
      leads_qualified: 2, // hot + warm
      qualification_rate_pct: 50,
      deals_won: 2,
      deals_won_prev: 1,
      won_value_total: 2000,
      currency: 'GTQ',
      conversion_pct: 50, // 2 won / 4 leads
      first_response_median_minutes: 12,
      followups_sent: 4,
      opportunities_recovered: 2,
      handoffs: 3,
      handoffs_advanced: 1,
      brief_completion_pct: 66.7, // rounded to 1dp
      temperature: { hot: 1, warm: 1, cold: 1, unclassified: 1 },
    });
  });

  it('nulls the rates when there are no leads', () => {
    const r = shapeReport(dataset({ leads: [], wonDeals: [] }), 7);
    expect(r.leads_generated).toBe(0);
    expect(r.qualification_rate_pct).toBeNull();
    expect(r.conversion_pct).toBeNull();
    expect(r.won_value_total).toBe(0);
    expect(r.currency).toBeNull();
  });
});
