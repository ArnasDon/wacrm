import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatCurrencyShort,
} from './currency';

describe('formatCurrency', () => {
  it('formats whole amounts with no minor units', () => {
    // Use a non-breaking-space-tolerant check: Intl may insert NBSP.
    const out = formatCurrency(1234, 'USD');
    expect(out).toContain('1,234');
    expect(out).not.toContain('.00');
  });

  it('defaults to USD when no currency is given', () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('treats an empty-string currency as the default', () => {
    expect(formatCurrency(10, '')).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('coerces non-finite values to 0', () => {
    expect(formatCurrency(Number.NaN, 'USD')).toContain('0');
  });

  it('renders a well-formed but unknown ISO code without throwing', () => {
    // Intl is lenient here — it uses the code as the symbol.
    const out = formatCurrency(1234, 'ZZZ');
    expect(out).toContain('ZZZ');
    expect(out).toContain('1,234');
  });

  it('never throws on a structurally invalid code (no DB CHECK on deals.currency)', () => {
    for (const bad of ['United States', 'US', 'USDD', '12', 'u$d']) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      expect(formatCurrency(1234, bad)).toContain('1,234');
    }
  });

  it('formats every offered currency without throwing', () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe('formatCurrencyShort', () => {
  it('abbreviates millions and thousands with the currency symbol', () => {
    expect(formatCurrencyShort(2_500_000, 'USD')).toBe('$2.5M');
    expect(formatCurrencyShort(3_400, 'USD')).toBe('$3.4k');
    expect(formatCurrencyShort(900, 'USD')).toBe('$900');
  });

  it('uses the matching symbol for non-USD currencies', () => {
    expect(formatCurrencyShort(1_000, 'EUR')).toBe('€1.0k');
    expect(formatCurrencyShort(1_000, 'INR')).toBe('₹1.0k');
  });

  it('falls back to the code prefix for unknown currencies (no throw)', () => {
    expect(formatCurrencyShort(1_000, 'ZZZ')).toBe('ZZZ 1.0k');
  });
});
