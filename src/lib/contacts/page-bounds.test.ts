import { describe, expect, it } from 'vitest';
import { lastPageIndex, pageAfterShrink } from './page-bounds';

describe('lastPageIndex', () => {
  it('is 0 for an empty result', () => {
    expect(lastPageIndex(0, 25)).toBe(0);
  });

  it('counts a partial final page', () => {
    expect(lastPageIndex(26, 25)).toBe(1);
    expect(lastPageIndex(50, 25)).toBe(1);
  });
});

describe('pageAfterShrink', () => {
  it('steps back when the last page was emptied by a delete', () => {
    expect(pageAfterShrink(2, 50, 25)).toBe(1);
  });

  it('keeps a page that still has rows', () => {
    expect(pageAfterShrink(1, 26, 25)).toBe(1);
  });

  it('falls back to the first page when everything was deleted', () => {
    expect(pageAfterShrink(3, 0, 25)).toBe(0);
  });
});

describe('pageAfterShrink without an exact total', () => {
  it('steps back one page at a time', () => {
    expect(pageAfterShrink(3, 0, 25, false)).toBe(2);
    expect(pageAfterShrink(0, 0, 25, false)).toBe(0);
  });
});
