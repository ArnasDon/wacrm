import { describe, expect, it } from 'vitest';
import { computeRoi, roiIsComparable } from './roi';

describe('computeRoi', () => {
  it('computes ROI as a fraction of spend', () => {
    // Spent 100, made back 150 -> 50% return.
    const out = computeRoi({ spend: 100, revenue: 150 });
    expect(out.roi).toBeCloseTo(0.5);
    expect(out.roas).toBeCloseTo(1.5);
  });

  it('returns a negative ROI when revenue is below spend', () => {
    const out = computeRoi({ spend: 200, revenue: 50 });
    expect(out.roi).toBeCloseTo(-0.75);
    expect(out.roas).toBeCloseTo(0.25);
  });

  it('returns null for both when spend is 0, even with real revenue', () => {
    // A campaign with revenue but no recorded spend (nothing synced
    // yet) should read as "not enough data", not an infinite return.
    const out = computeRoi({ spend: 0, revenue: 500 });
    expect(out.roi).toBeNull();
    expect(out.roas).toBeNull();
  });

  it('returns null for a negative spend', () => {
    const out = computeRoi({ spend: -10, revenue: 50 });
    expect(out.roi).toBeNull();
    expect(out.roas).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(computeRoi({ spend: Number.NaN, revenue: 50 }).roi).toBeNull();
    expect(computeRoi({ spend: 100, revenue: Number.NaN }).roi).toBeNull();
    expect(computeRoi({ spend: Infinity, revenue: 50 }).roi).toBeNull();
  });

  it('returns 0 ROI and ROAS when revenue is exactly 0', () => {
    const out = computeRoi({ spend: 100, revenue: 0 });
    expect(out.roi).toBe(-1);
    expect(out.roas).toBe(0);
  });
});

describe('roiIsComparable', () => {
  it('is comparable when currencies match', () => {
    expect(roiIsComparable('PEN', 'PEN')).toBe(true);
  });

  it('is not comparable across different currencies (no FX conversion)', () => {
    expect(roiIsComparable('USD', 'PEN')).toBe(false);
  });
});
