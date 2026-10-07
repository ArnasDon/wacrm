import { describe, it, expect } from 'vitest';

import {
  chunk,
  fetchAllInChunks,
  fetchAllPages,
  IN_CHUNK_SIZE,
  PAGE_SIZE,
  type PageResult,
} from './paged-query';

function cappedSource(total: number, maxRows: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return { data: rows.slice(from, end), error: null };
  };
  return { fetchPage, calls };
}

describe('chunk', () => {
  it('splits into slices no larger than the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no slices for an empty list', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('defaults to a URL-safe slice size', () => {
    const ids = Array.from({ length: IN_CHUNK_SIZE * 2 + 1 }, (_, i) => i);
    expect(chunk(ids).map((c) => c.length)).toEqual([
      IN_CHUNK_SIZE,
      IN_CHUNK_SIZE,
      1,
    ]);
  });

  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('fetchAllPages', () => {
  it('reads past the 1000-row cap', async () => {
    const { fetchPage, calls } = cappedSource(2812, 1000);
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toHaveLength(2812);
    expect(rows[2811]).toBe(2811);
    expect(calls[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(calls[1]).toEqual([1000, 1000 + PAGE_SIZE - 1]);
  });

  it('stays complete when the server cap is lower than the page size', async () => {
    const { fetchPage } = cappedSource(1234, 250);
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toEqual(Array.from({ length: 1234 }, (_, i) => i));
  });

  it('handles an exact multiple of the page size', async () => {
    const { fetchPage } = cappedSource(2000, 1000);
    expect(await fetchAllPages(fetchPage)).toHaveLength(2000);
  });

  it('treats null data as the end', async () => {
    expect(await fetchAllPages(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it('throws the PostgREST error message', async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: 'boom' } })),
    ).rejects.toThrow('boom');
  });
});

describe('fetchAllInChunks', () => {
  it('makes no request for an empty list', async () => {
    let calls = 0;
    const rows = await fetchAllInChunks([], async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });

  it('chunks the values and pages each chunk', async () => {
    const values = Array.from({ length: 250 }, (_, i) => i);
    const seen: number[][] = [];
    const rows = await fetchAllInChunks(
      values,
      async (slice, from) => {
        if (from === 0) seen.push(slice);
        const fanOut = slice.flatMap((v) => [v, v + 0.5]);
        return { data: fanOut.slice(from, from + 30), error: null };
      },
      100,
    );
    expect(seen.map((s) => s.length)).toEqual([100, 100, 50]);
    expect(rows).toHaveLength(500);
  });
});
