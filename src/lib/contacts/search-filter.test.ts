import { describe, expect, it } from 'vitest';
import { contactSearchFilter, sanitizeContactSearch } from './search-filter';

describe('sanitizeContactSearch', () => {
  it('removes PostgREST delimiters a name or phone may contain', () => {
    expect(sanitizeContactSearch('Doe, John')).toBe('Doe John');
    expect(sanitizeContactSearch('(312) 555-1234')).toBe('312 555-1234');
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
});
