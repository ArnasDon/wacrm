import { describe, expect, it } from 'vitest';
import {
  contactSearchFilter,
  contactSearchPattern,
  phoneSearchDigits,
  sanitizeContactSearch,
} from './search-filter';

describe('sanitizeContactSearch', () => {
  it('removes PostgREST delimiters a name or phone may contain', () => {
    expect(sanitizeContactSearch('Doe, John')).toBe('Doe John');
    expect(sanitizeContactSearch('(312) 555-1234')).toBe('312 555-1234');
  });

  it("keeps the apostrophe in O'Brien", () => {
    expect(sanitizeContactSearch("O'Brien")).toBe("O'Brien");
    expect(sanitizeContactSearch('"O\'Brien":')).toBe("O'Brien");
  });
});

describe('contactSearchFilter', () => {
  it('keeps the comma in "Doe, John" from splitting the or() filter', () => {
    expect(contactSearchFilter('Doe, John')).toBe('name.ilike.*Doe John*');
  });

  it('matches a formatted phone number by its digits', () => {
    expect(contactSearchFilter('(312) 555-1234')).toBe(
      'name.ilike.*312 555-1234*,phone.ilike.*3125551234*'
    );
  });

  it('adds an email condition when asked', () => {
    expect(contactSearchFilter('jane_doe@x.io', { includeEmail: true })).toBe(
      'name.ilike.*jane\\_doe@x.io*,email.ilike.*jane\\_doe@x.io*'
    );
  });

  it('returns null when nothing searchable is left', () => {
    expect(contactSearchFilter('(),*', { includeEmail: true })).toBeNull();
  });

  it('does not reduce an email with a digit to a digits-only phone match', () => {
    expect(contactSearchFilter('bob1@gmail.com', { includeEmail: true })).toBe(
      'name.ilike.*bob1@gmail.com*,phone.ilike.*bob1@gmail.com*,email.ilike.*bob1@gmail.com*'
    );
  });

  it('matches mixed text against the phone column as typed', () => {
    expect(contactSearchFilter('Room 2B')).toBe(
      'name.ilike.*Room 2B*,phone.ilike.*Room 2B*'
    );
  });

  it('matches a partial formatted phone number by its digits', () => {
    expect(contactSearchFilter('+1 415 555')).toBe(
      'name.ilike.*+1 415 555*,phone.ilike.*1415555*'
    );
  });

  it("finds O'Brien", () => {
    expect(contactSearchFilter("O'Brien")).toBe("name.ilike.*O'Brien*");
  });
});

describe('phoneSearchDigits', () => {
  it('returns the digits of a phone-shaped term', () => {
    expect(phoneSearchDigits(' (312) 555-1234 ')).toBe('3125551234');
    expect(phoneSearchDigits('312.555')).toBe('312555');
  });

  it('rejects terms with letters or too few digits', () => {
    expect(phoneSearchDigits('bob1@gmail.com')).toBeNull();
    expect(phoneSearchDigits('Room 2B')).toBeNull();
    expect(phoneSearchDigits('(1)')).toBeNull();
  });
});

describe('contactSearchPattern', () => {
  it('uses the digits for a phone-shaped term', () => {
    expect(contactSearchPattern('+1 (415) 555-1234')).toBe('14155551234');
  });

  it('uses the sanitized, underscore-escaped text otherwise', () => {
    expect(contactSearchPattern("O'Brien, Jane_D")).toBe("O'Brien Jane\\_D");
    expect(contactSearchPattern('100%')).toBe('100');
  });

  it('returns null when nothing searchable is left', () => {
    expect(contactSearchPattern(' ,()* ')).toBeNull();
  });
});
