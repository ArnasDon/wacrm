import { describe, expect, it } from 'vitest';
import { costPerUnit, sumDailyMetrics } from './metrics';

describe('sumDailyMetrics', () => {
  it('sums spend, impressions and clicks across days', () => {
    const out = sumDailyMetrics([
      { date: '2026-07-01', spend: 10, impressions: 100, clicks: 5, messagingStarted: 2 },
      { date: '2026-07-02', spend: 15, impressions: 200, clicks: 8, messagingStarted: 3 },
    ]);
    expect(out).toEqual({
      spend: 25,
      impressions: 300,
      clicks: 13,
      messagingStarted: 5,
    });
  });

  it('returns zeroed totals and null messagingStarted for an empty range', () => {
    expect(sumDailyMetrics([])).toEqual({
      spend: 0,
      impressions: 0,
      clicks: 0,
      messagingStarted: null,
    });
  });

  it('keeps messagingStarted null when no day reported it, not 0', () => {
    // A manual campaign (Google) never has Meta's messaging metric —
    // null must survive so the UI can render "n/d" instead of "0".
    const out = sumDailyMetrics([
      { date: '2026-07-01', spend: 10, impressions: 100, clicks: 5, messagingStarted: null },
    ]);
    expect(out.messagingStarted).toBeNull();
  });

  it('treats a real zero from Meta as 0, not null, once any day reports a value', () => {
    const out = sumDailyMetrics([
      { date: '2026-07-01', spend: 10, impressions: 100, clicks: 5, messagingStarted: 0 },
      { date: '2026-07-02', spend: 10, impressions: 100, clicks: 5, messagingStarted: null },
    ]);
    expect(out.messagingStarted).toBe(0);
  });

  it('coerces non-numeric spend/impressions/clicks to 0 instead of NaN', () => {
    // Defensive: raw JSONB from Meta or a bad manual entry should never
    // poison the whole sum with a NaN.
    const out = sumDailyMetrics([
      {
        date: '2026-07-01',
        spend: Number('not-a-number'),
        impressions: 100,
        clicks: 5,
        messagingStarted: null,
      },
    ]);
    expect(out.spend).toBe(0);
  });
});

describe('costPerUnit', () => {
  it('divides spend by count', () => {
    expect(costPerUnit(100, 4)).toBe(25);
  });

  it('returns null instead of Infinity when count is 0', () => {
    // A campaign with real spend and zero leads is exactly the case
    // worth flagging as "n/d", not hiding behind Infinity or 0.
    expect(costPerUnit(100, 0)).toBeNull();
  });

  it('returns null for a negative count', () => {
    expect(costPerUnit(100, -1)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(costPerUnit(Number.NaN, 4)).toBeNull();
    expect(costPerUnit(100, Number.NaN)).toBeNull();
    expect(costPerUnit(Infinity, 4)).toBeNull();
  });

  it('returns 0 when spend is 0 and there were leads', () => {
    expect(costPerUnit(0, 5)).toBe(0);
  });
});
