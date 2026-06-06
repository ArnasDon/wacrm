import { describe, expect, it } from 'vitest';

import { parseKeywordList } from './keyword-list';

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
