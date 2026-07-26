import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  formatAnalyticsDuration,
  formatAnalyticsPercent,
} from './analytics-view';

const pageSource = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/flows/[id]/analytics/page.tsx'),
  'utf8'
);
const headerSource = readFileSync(
  join(process.cwd(), 'src/components/flows/header.tsx'),
  'utf8'
);

describe('flow analytics UI', () => {
  it('never renders NaN and uses a dash for unavailable metrics', () => {
    expect(formatAnalyticsPercent(null)).toBe('—');
    expect(formatAnalyticsPercent(Number.NaN)).toBe('—');
    expect(formatAnalyticsPercent(0)).toBe('0%');
    expect(formatAnalyticsDuration(null)).toBe('—');
    expect(formatAnalyticsDuration(Number.NaN)).toBe('—');
    expect(formatAnalyticsDuration(0)).toBe('0 ms');
  });

  it('provides accessible loading, error, empty, filters, and funnel states', () => {
    expect(pageSource).toMatch(/useTranslations\(['"]Flows\.analytics['"]\)/);
    expect(pageSource).toContain('role="status"');
    expect(pageSource).toContain('role="alert"');
    expect(pageSource).toMatch(/aria-label=\{t\(['"]periodLabel['"]\)\}/);
    expect(pageSource).toMatch(/aria-label=\{t\(['"]versionLabel['"]\)\}/);
    expect(pageSource).toContain('scope="col"');
    expect(pageSource).toMatch(/aria-label=\{t\(['"]funnelBarLabel['"]/);
    expect(pageSource).toContain('role="img"');
    expect(pageSource).toContain('data-testid="analytics-empty"');
    expect(pageSource).toContain('coverage_started_at');
    expect(pageSource).toContain('biggest_dropoff');
  });

  it('never labels stale analytics as the newly requested filters and can retry', () => {
    expect(pageSource).toContain('setData(null)');
    expect(pageSource).toContain('data-testid="analytics-retry"');
    expect(pageSource).toMatch(/setRetryNonce\(\(value\) => value \+ 1\)/);
    expect(pageSource).toMatch(/\[params\.id, period, retryNonce, versionId\]/);
    expect(pageSource).not.toContain("t('refreshError')");
  });

  it('links the editor header to the analytics page', () => {
    expect(headerSource).toContain('BarChart3');
    expect(headerSource).toContain('`/flows/${flow.id}/analytics`');
    expect(headerSource).toContain('tAnalytics("open")');
  });
});
