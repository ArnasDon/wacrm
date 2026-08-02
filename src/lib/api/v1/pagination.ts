// ============================================================
// Cursor pagination for public API (v1) list endpoints.
//
// Every `/api/v1` list route (contacts, conversations, messages,
// broadcasts) pages the same way so integrators write one loop:
//
//   GET /api/v1/contacts?limit=50
//   → { "data": [...], "meta": { "next_cursor": "…" } }
//   GET /api/v1/contacts?limit=50&cursor=…      // next page
//   → { "data": [...], "meta": { "next_cursor": null } }   // last page
//
// Cursors are **keyset** (not offset): rows are ordered by
// `(created_at, id)` descending and the cursor encodes the last row's
// `(created_at, id)`. This is stable under concurrent inserts (an
// offset would skip/repeat rows when new data lands mid-scan) and
// stays fast at any depth. The cursor is an opaque base64 string —
// clients pass it back verbatim and never parse it.
// ============================================================

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface Cursor {
  createdAt: string;
  id: string;
}

export interface ListParams {
  /** Clamped to [1, MAX_LIMIT]. */
  limit: number;
  /** Decoded cursor, or null on the first page. */
  cursor: Cursor | null;
}

/**
 * Parse `?limit` and `?cursor` off a request URL. `limit` is clamped
 * to [1, MAX_LIMIT] (default {@link DEFAULT_LIMIT}); a malformed or
 * unparseable `cursor` is treated as absent (first page) rather than
 * erroring — the worst case is the client re-reads from the top.
 */
export function parseListParams(request: Request): ListParams {
  const url = new URL(request.url);

  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  return { limit, cursor: decodeCursor(url.searchParams.get('cursor')) };
}

/** Encode a row's `(created_at, id)` into an opaque cursor string. */
export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(`${row.created_at}|${row.id}`, 'utf8').toString(
    'base64url'
  );
}

// A cursor is only ever minted by `encodeCursor` from a real row's
// `created_at` (ISO timestamp) + `id` (UUID). We re-validate both on
// decode so a hand-crafted cursor can't smuggle PostgREST filter
// syntax into `keysetFilter`'s `.or()` string (the values are
// interpolated raw). Anything that doesn't look server-issued is
// treated as "no cursor" — the documented tolerance is to restart
// from the first page, never to run an attacker-shaped query.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decode a cursor string, or null if missing/malformed/untrusted. */
export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep === -1) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    // Reject anything that isn't a plausible server-issued cursor: an
    // ISO-8601 timestamp and a UUID. This is what keeps the raw
    // interpolation in `keysetFilter` safe.
    if (!UUID_RE.test(id)) return null;
    const ts = Date.parse(createdAt);
    if (Number.isNaN(ts)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * PostgREST `.or()` expression that walks *past* the cursor row under
 * a `(created_at desc, id desc)` ordering: strictly-older rows, plus
 * same-timestamp rows with a smaller id (the tie-breaker). Returns
 * null on the first page. Apply as:
 *
 *   let q = db.from('contacts').select('*').eq('account_id', accountId)
 *     .order('created_at', { ascending: false })
 *     .order('id', { ascending: false })
 *     .limit(limit + 1)          // fetch one extra to detect a next page
 *   const f = keysetFilter(cursor)
 *   if (f) q = q.or(f)
 */
export function keysetFilter(cursor: Cursor | null): string | null {
  if (!cursor) return null;
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

/**
 * Trim an over-fetched result set (query ran with `limit + 1`) down to
 * `limit` and derive the `next_cursor`. When fewer than `limit + 1`
 * rows came back, this is the last page and `nextCursor` is null.
 */
export function buildPage<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(items[items.length - 1]) };
}
