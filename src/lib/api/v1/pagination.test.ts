import { describe, it, expect } from 'vitest';
import {
  parseListParams,
  encodeCursor,
  decodeCursor,
  keysetFilter,
  buildPage,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './pagination';

const req = (qs: string) => new Request(`https://x.test/api/v1/contacts${qs}`);

describe('parseListParams', () => {
  it('defaults limit and cursor', () => {
    expect(parseListParams(req(''))).toEqual({
      limit: DEFAULT_LIMIT,
      cursor: null,
    });
  });

  it('clamps limit to MAX_LIMIT and floors it', () => {
    expect(parseListParams(req('?limit=9999')).limit).toBe(MAX_LIMIT);
    expect(parseListParams(req('?limit=10.9')).limit).toBe(10);
  });

  it('falls back to default on non-positive / NaN limit', () => {
    expect(parseListParams(req('?limit=0')).limit).toBe(DEFAULT_LIMIT);
    expect(parseListParams(req('?limit=-5')).limit).toBe(DEFAULT_LIMIT);
    expect(parseListParams(req('?limit=abc')).limit).toBe(DEFAULT_LIMIT);
  });

  it('decodes a valid cursor and ignores a malformed one', () => {
    const c = encodeCursor({
      created_at: '2026-01-01T00:00:00Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
    expect(parseListParams(req(`?cursor=${c}`)).cursor).toEqual({
      createdAt: '2026-01-01T00:00:00Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
    expect(parseListParams(req('?cursor=@@notbase64@@')).cursor).toBeNull();
  });
});

describe('encode/decodeCursor round-trip', () => {
  it('round-trips a real (ISO timestamp, UUID) cursor', () => {
    const row = {
      created_at: '2026-06-30T12:00:00.123Z',
      id: 'abcdef01-2345-4678-8abc-def012345678',
    };
    expect(decodeCursor(encodeCursor(row))).toEqual({
      createdAt: '2026-06-30T12:00:00.123Z',
      id: 'abcdef01-2345-4678-8abc-def012345678',
    });
  });

  it('returns null for empty / separator-less input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(Buffer.from('nosep').toString('base64url'))).toBeNull();
  });

  it('rejects a crafted cursor whose id is not a UUID (filter-injection guard)', () => {
    // A hand-built cursor trying to smuggle PostgREST filter syntax
    // through keysetFilter must be refused, not decoded.
    const evil = Buffer.from(
      '2026-01-01T00:00:00Z|x),or(account_id.neq.0',
      'utf8'
    ).toString('base64url');
    expect(decodeCursor(evil)).toBeNull();
  });

  it('rejects a cursor whose timestamp is not parseable', () => {
    const bad = Buffer.from(
      'not-a-date|11111111-1111-4111-8111-111111111111',
      'utf8'
    ).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe('keysetFilter', () => {
  it('is null on the first page', () => {
    expect(keysetFilter(null)).toBeNull();
  });

  it('walks strictly past the cursor row (older, or same-ts smaller id)', () => {
    expect(keysetFilter({ createdAt: '2026-01-01T00:00:00Z', id: 'x' })).toBe(
      'created_at.lt.2026-01-01T00:00:00Z,and(created_at.eq.2026-01-01T00:00:00Z,id.lt.x)'
    );
  });
});

describe('buildPage', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    created_at: `2026-01-0${i + 1}T00:00:00Z`,
    id: `id${i + 1}`,
  }));

  it('returns all rows and null cursor when not over-fetched', () => {
    const page = buildPage(rows.slice(0, 3), 5);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('trims to limit and emits a cursor for the last kept row', () => {
    const page = buildPage(rows, 5);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBe(encodeCursor(rows[4]));
  });
});
