import { describe, expect, it } from 'vitest';
import {
  buildPrefilledMessage,
  extractRefCode,
  formatRefTag,
  generateRefCode,
  isValidRefCode,
} from './ref-token';

describe('generateRefCode', () => {
  it('generates a 6-character lowercase alphanumeric code', () => {
    const code = generateRefCode();
    expect(code).toMatch(/^[a-z0-9]{6}$/);
  });

  it('generates different codes across calls', () => {
    // Not a statistical proof, just a sanity check against a constant
    // generator bug.
    const codes = new Set(Array.from({ length: 20 }, generateRefCode));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('isValidRefCode', () => {
  it('accepts codes in the 4-12 char alphanumeric range', () => {
    expect(isValidRefCode('a1b2c3')).toBe(true);
    expect(isValidRefCode('ab12')).toBe(true);
    expect(isValidRefCode('abcdefghij12')).toBe(true);
  });

  it('rejects too-short, too-long, or non-alphanumeric values', () => {
    expect(isValidRefCode('ab1')).toBe(false);
    expect(isValidRefCode('abcdefghijklm')).toBe(false);
    expect(isValidRefCode('a b!c3')).toBe(false);
    expect(isValidRefCode(123456)).toBe(false);
    expect(isValidRefCode(null)).toBe(false);
  });
});

describe('formatRefTag', () => {
  it('wraps the code in the bracket tag', () => {
    expect(formatRefTag('a1b2c3')).toBe('[#a1b2c3]');
  });
});

describe('extractRefCode', () => {
  it('extracts the code from a message ending with the tag', () => {
    expect(extractRefCode('Hola, quiero información [#a1b2c3]')).toBe('a1b2c3');
  });

  it('is case-insensitive on input but normalises to lowercase', () => {
    expect(extractRefCode('Hola [#A1B2C3]')).toBe('a1b2c3');
  });

  it('returns null when there is no tag', () => {
    expect(extractRefCode('Hola, quiero información')).toBeNull();
    expect(extractRefCode('')).toBeNull();
    expect(extractRefCode(null)).toBeNull();
    expect(extractRefCode(undefined)).toBeNull();
  });

  it('only matches a tag at the end, not one typed in the middle by the customer', () => {
    // A customer who edits the pre-filled text and adds their own words
    // after it shifts the tag away from the end; we intentionally do
    // not chase it into the middle of arbitrary text to avoid matching
    // something a customer typed that merely looks like our tag.
    expect(extractRefCode('[#a1b2c3] but then I added more text')).toBeNull();
  });

  it('ignores a malformed or too-short bracket sequence', () => {
    expect(extractRefCode('Hola [#ab]')).toBeNull();
  });
});

describe('buildPrefilledMessage', () => {
  it('appends the tag after the template with a separating space', () => {
    expect(buildPrefilledMessage('Hola, quiero información', 'a1b2c3')).toBe(
      'Hola, quiero información [#a1b2c3]',
    );
  });

  it('trims the template before appending', () => {
    expect(buildPrefilledMessage('  Hola  ', 'a1b2c3')).toBe('Hola [#a1b2c3]');
  });

  it('produces just the tag when the template is empty', () => {
    expect(buildPrefilledMessage('', 'a1b2c3')).toBe('[#a1b2c3]');
    expect(buildPrefilledMessage('   ', 'a1b2c3')).toBe('[#a1b2c3]');
  });

  it('round-trips through extractRefCode', () => {
    const code = generateRefCode();
    const message = buildPrefilledMessage('Hola, vengo de su anuncio', code);
    expect(extractRefCode(message)).toBe(code);
  });
});
