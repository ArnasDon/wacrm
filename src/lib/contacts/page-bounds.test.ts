import { describe, expect, it } from 'vitest';
import {
  lastPageIndex,
  pageAfterRangeError,
  pageAfterShrink,
} from './page-bounds';

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

describe('pageAfterRangeError', () => {
  it('jumps to the last page the reported total still fills', () => {
    expect(
      pageAfterRangeError(4, 25, {
        code: 'PGRST103',
        details: 'An offset of 100 was requested, but there are only 30 rows.',
      })
    ).toBe(1);
  });

  it('falls back to the first page when no rows are left', () => {
    expect(
      pageAfterRangeError(2, 25, {
        code: 'PGRST103',
        details: 'An offset of 50 was requested, but there are only 0 rows.',
      })
    ).toBe(0);
  });

  it('steps back one page when the total is not reported', () => {
    expect(pageAfterRangeError(3, 25, { code: 'PGRST103', details: null })).toBe(2);
  });

  it('ignores other errors', () => {
    expect(pageAfterRangeError(3, 25, { code: '42501', details: null })).toBeNull();
  });
});
