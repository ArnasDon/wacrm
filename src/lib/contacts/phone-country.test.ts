import { describe, expect, it } from 'vitest';

import {
  PHONE_COUNTRIES,
  findPhoneCountry,
  phoneCountryLikePattern,
  phoneCountryOptions,
  phoneMatchesCountry,
} from './phone-country';

describe('PHONE_COUNTRIES', () => {
  it('includes the starter set', () => {
    expect(findPhoneCountry('91')?.regions).toEqual(['IN']);
    expect(findPhoneCountry('1')?.regions).toEqual(['US', 'CA']);
    expect(findPhoneCountry('44')?.regions).toEqual(['GB']);
  });

  it('has unique, digit-only calling codes', () => {
    const codes = PHONE_COUNTRIES.map((c) => c.callingCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[1-9]\d{0,2}$/);
  });

  it('never lists a calling code that is a prefix of another', () => {
    const codes = PHONE_COUNTRIES.map((c) => c.callingCode);
    for (const a of codes) {
      for (const b of codes) {
        if (a !== b) expect(b.startsWith(a)).toBe(false);
      }
    }
  });
});

describe('phoneMatchesCountry', () => {
  it('matches on the normalized international prefix', () => {
    expect(phoneMatchesCountry('+91 98765 43210', '91')).toBe(true);
    expect(phoneMatchesCountry('919876543210', '91')).toBe(true);
    expect(phoneMatchesCountry('+1 (415) 555-1212', '1')).toBe(true);
    expect(phoneMatchesCountry('+44 20 7946 0958', '44')).toBe(true);
  });

  it('does not match a different calling code', () => {
    expect(phoneMatchesCountry('+44 20 7946 0958', '91')).toBe(false);
    expect(phoneMatchesCountry('+4915112345678', '44')).toBe(false);
    expect(phoneMatchesCountry('+37063949836', '1')).toBe(false);
  });

  it('never matches a contact without a phone', () => {
    expect(phoneMatchesCountry('', '1')).toBe(false);
  });

  it('rejects calling codes outside the list', () => {
    expect(phoneMatchesCountry('+4420794609', '4')).toBe(false);
    expect(phoneMatchesCountry('+919876543210', '9%')).toBe(false);
  });
});

describe('phoneCountryLikePattern', () => {
  it('builds a prefix pattern for known codes only', () => {
    expect(phoneCountryLikePattern('91')).toBe('91%');
    expect(phoneCountryLikePattern('4')).toBeNull();
    expect(phoneCountryLikePattern('%')).toBeNull();
    expect(phoneCountryLikePattern(null)).toBeNull();
    expect(phoneCountryLikePattern(undefined)).toBeNull();
  });
});

describe('phoneCountryOptions', () => {
  it('labels every country with its region names and calling code', () => {
    const options = phoneCountryOptions('en');
    expect(options).toHaveLength(PHONE_COUNTRIES.length);
    expect(options.find((o) => o.callingCode === '1')?.label).toBe(
      'United States / Canada (+1)',
    );
    expect(options.find((o) => o.callingCode === '91')?.label).toBe(
      'India (+91)',
    );
  });

  it('sorts options by label', () => {
    const labels = phoneCountryOptions('en').map((o) => o.label);
    expect(labels).toEqual(
      [...labels].sort((a, b) => a.localeCompare(b, 'en')),
    );
  });
});
