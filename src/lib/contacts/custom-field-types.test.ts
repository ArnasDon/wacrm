import { describe, expect, it } from 'vitest';
import {
  coerceCustomFieldType,
  decodeCustomFieldSelectValue,
  encodeCustomFieldSelectValue,
  formatCustomValue,
  parseCustomValue,
  parseSelectOptions,
  serializeCustomValue,
  validateCustomValue,
} from './custom-field-types';

describe('custom field types', () => {
  it('coerces unknown field types to text', () => {
    expect(coerceCustomFieldType('date')).toBe('date');
    expect(coerceCustomFieldType('currency')).toBe('text');
    expect(coerceCustomFieldType(null)).toBe('text');
  });

  it('round-trips text-like values through canonical TEXT storage', () => {
    for (const type of ['text', 'date', 'select', 'url', 'phone'] as const) {
      expect(
        serializeCustomValue(type, parseCustomValue(type, '  abc  '))
      ).toBe('abc');
    }
  });

  it('parses and serializes numbers', () => {
    expect(parseCustomValue('number', ' 12.50 ')).toBe(12.5);
    expect(serializeCustomValue('number', 12.5)).toBe('12.5');
    expect(validateCustomValue('number', '12.5')).toBeNull();
    expect(validateCustomValue('number', 'not a number')).toBe(
      'Enter a valid number.'
    );
  });

  it('validates ISO dates', () => {
    expect(validateCustomValue('date', '2026-07-22')).toBeNull();
    expect(validateCustomValue('date', '2026-02-31')).toBe(
      'Enter a valid date.'
    );
    expect(validateCustomValue('date', '07/22/2026')).toBe(
      'Enter a valid date.'
    );
  });

  it('normalizes select options and validates selected values', () => {
    const options = { options: [' A ', 'B', 'a', '', 3] } as unknown;
    expect(parseSelectOptions(options)).toEqual(['A', 'B']);
    expect(validateCustomValue('select', 'A', options)).toBeNull();
    expect(validateCustomValue('select', 'C', options)).toBe(
      'Choose one of the configured options.'
    );
    expect(validateCustomValue('select', 'A', { options: [] })).toBe(
      'Add select options before saving a value.'
    );
  });

  it('encodes select values without reserving user-entered option text', () => {
    const encoded = encodeCustomFieldSelectValue('__none__');
    expect(encoded).not.toBe('__none__');
    expect(decodeCustomFieldSelectValue(encoded)).toBe('__none__');
    expect(decodeCustomFieldSelectValue('__custom_field_empty__')).toBe('');
  });

  it('parses, serializes, and formats checkboxes', () => {
    expect(parseCustomValue('checkbox', 'true')).toBe(true);
    expect(parseCustomValue('checkbox', 'false')).toBe(false);
    expect(serializeCustomValue('checkbox', true)).toBe('true');
    expect(serializeCustomValue('checkbox', false)).toBe('false');
    expect(formatCustomValue('checkbox', 'true')).toBe('Yes');
    expect(
      formatCustomValue('checkbox', 'false', {
        checkboxLabels: { checked: 'Sim', unchecked: 'Nao' },
      })
    ).toBe('Nao');
  });

  it('validates URLs and phone numbers', () => {
    expect(validateCustomValue('url', 'https://example.com')).toBeNull();
    expect(validateCustomValue('url', 'ftp://example.com')).toBe(
      'Enter a valid HTTP or HTTPS URL.'
    );
    expect(validateCustomValue('url', 'example')).toBe('Enter a valid URL.');
    expect(validateCustomValue('phone', '+1 (555) 123-4567')).toBeNull();
    expect(validateCustomValue('phone', 'ab')).toBe(
      'Enter a valid phone number.'
    );
  });

  it('formats numbers while leaving invalid raw values visible', () => {
    expect(formatCustomValue('number', '1200.5')).toBe('1,200.5');
    expect(formatCustomValue('number', 'abc')).toBe('abc');
  });
});
