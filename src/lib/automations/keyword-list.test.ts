import { describe, expect, it } from 'vitest';

import { normalizeKeywordMatchType, parseKeywordList } from './keyword-list';

describe('parseKeywordList', () => {
  it('keeps multi-word keywords while trimming comma-separated entries', () => {
    expect(parseKeywordList('SEO, search engine optimization')).toEqual([
      'SEO',
      'search engine optimization',
    ]);
  });

  it('drops empty entries from duplicate or trailing commas', () => {
    expect(parseKeywordList('seo,,ads, ')).toEqual(['seo', 'ads']);
  });
});

describe('normalizeKeywordMatchType', () => {
  it('keeps valid match types', () => {
    expect(normalizeKeywordMatchType('exact')).toBe('exact');
    expect(normalizeKeywordMatchType('contains')).toBe('contains');
  });

  it('defaults missing or unknown values to contains', () => {
    expect(normalizeKeywordMatchType(undefined)).toBe('contains');
    expect(normalizeKeywordMatchType('')).toBe('contains');
    expect(normalizeKeywordMatchType('starts_with')).toBe('contains');
  });
});
