import { describe, it, expect } from 'vitest';
import { isValidApiUrl, parseApiHeaders, parseApiParams } from './validate';

describe('isValidApiUrl', () => {
  it('accepts http/https URLs', () => {
    expect(isValidApiUrl('https://api.example.com/weather')).toBe(true);
    expect(isValidApiUrl('http://api.example.com')).toBe(true);
  });

  it('rejects non-http(s) schemes and malformed URLs', () => {
    expect(isValidApiUrl('file:///etc/passwd')).toBe(false);
    expect(isValidApiUrl('ftp://example.com')).toBe(false);
    expect(isValidApiUrl('not a url')).toBe(false);
  });
});

describe('parseApiParams', () => {
  it('defaults to an empty array when omitted', () => {
    expect(parseApiParams(undefined)).toEqual({ ok: true, value: [] });
  });

  it('accepts well-formed params', () => {
    const result = parseApiParams([
      { name: 'city', description: 'City name', required: true },
      { name: 'units', description: 'metric or imperial', required: false },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'city', description: 'City name', required: true },
        { name: 'units', description: 'metric or imperial', required: false },
      ],
    });
  });

  it('rejects a non-identifier name', () => {
    const result = parseApiParams([{ name: 'city name!', description: 'x', required: false }]);
    expect(result.ok).toBe(false);
  });

  it('rejects the reserved API_KEY name', () => {
    const result = parseApiParams([{ name: 'API_KEY', description: 'x', required: false }]);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing description', () => {
    const result = parseApiParams([{ name: 'city', description: '', required: false }]);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate names', () => {
    const result = parseApiParams([
      { name: 'city', description: 'a', required: false },
      { name: 'city', description: 'b', required: false },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects too many params', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      name: `p${i}`,
      description: 'x',
      required: false,
    }));
    expect(parseApiParams(many).ok).toBe(false);
  });
});

describe('parseApiHeaders', () => {
  it('defaults to an empty object when omitted', () => {
    expect(parseApiHeaders(undefined)).toEqual({ ok: true, value: {} });
  });

  it('accepts a flat string map', () => {
    const result = parseApiHeaders({ 'x-api-key': '{API_KEY}', Accept: 'application/json' });
    expect(result).toEqual({
      ok: true,
      value: { 'x-api-key': '{API_KEY}', Accept: 'application/json' },
    });
  });

  it('rejects a non-object payload', () => {
    expect(parseApiHeaders(['x'])).toEqual({ ok: false, error: expect.any(String) });
    expect(parseApiHeaders('x').ok).toBe(false);
  });

  it('rejects a non-string header value', () => {
    const result = parseApiHeaders({ 'x-api-key': 123 });
    expect(result.ok).toBe(false);
  });
});
