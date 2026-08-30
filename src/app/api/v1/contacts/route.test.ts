import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/v1/contacts — HTTP-level regression test for the
// decodeCursor()/keysetFilter() SSRF-adjacent filter-injection fix
// (API Pública v1 audit). Not a general test suite for this route —
// only the specific demonstration the fix requires: a cursor crafted
// to slip past the old Date.parse()-only validation must never reach
// PostgREST as raw, unescaped filter syntax, and must never produce a
// 500 — it must be treated exactly like any other malformed/unknown
// cursor already is: silently as "no cursor" (first page).
// ============================================================

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));

import { GET } from './route';

/** Generic in-memory fake for `contacts` — chainable AND directly
 *  awaitable (implements `.then`), matching the real call shape this
 *  route uses. Records every `.or()` call it receives so a test can
 *  assert no attacker-shaped filter string ever reached the "backend". */
function fakeSupabase(rows: Record<string, unknown>[]) {
  const orCalls: string[] = [];

  function builder() {
    const api = {
      select: () => api,
      eq: () => api,
      or: (expr: string) => {
        orCalls.push(expr);
        return api;
      },
      order: () => api,
      limit: () => api,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return api;
  }

  return {
    supabase: { from: () => builder() } as never,
    orCalls,
  };
}

function contact(id: string, createdAt: string) {
  return {
    id,
    account_id: 'acct-1',
    phone: '+15550000000',
    name: null,
    email: null,
    company: null,
    avatar_url: null,
    contact_tags: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

beforeEach(() => {
  mocks.requireApiKey.mockReset();
});

describe('GET /api/v1/contacts — cursor filter-injection fix', () => {
  it('a cursor crafted with an RFC-1123 createdAt (comma) never reaches PostgREST as raw filter syntax, never 500s, and behaves as "no cursor" (first page)', async () => {
    const { supabase, orCalls } = fakeSupabase([contact('c1', '2026-01-01T00:00:00Z')]);
    mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

    // Exactly the payload proven in the audit to pass the OLD
    // Date.parse()-only check: a valid UUID + an RFC-1123 date string
    // (Date.parse("Thu, 01 Jan 1970 00:00:00 GMT") === 0, not NaN).
    const evilCursor = Buffer.from(
      'Thu, 01 Jan 1970 00:00:00 GMT|11111111-1111-1111-1111-111111111111',
      'utf8',
    ).toString('base64url');

    const res = await GET(new Request(`http://localhost/api/v1/contacts?cursor=${evilCursor}`));
    const body = (await res.json()) as { data: { id: string }[] };

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    // Treated as no cursor at all — the query never called .or() with
    // a keyset filter (the ONLY thing that could carry the crafted
    // string into PostgREST). This is the actual proof the injection
    // never reached the "backend": there is no unescaped comma/paren
    // anywhere in what was sent.
    expect(orCalls).toEqual([]);
    expect(body.data.map((c) => c.id)).toEqual(['c1']); // first page, normal contact returned
  });

  it('a cursor crafted with a Date.prototype.toString()-style createdAt (parentheses) is rejected the same way', async () => {
    const { supabase, orCalls } = fakeSupabase([contact('c1', '2026-01-01T00:00:00Z')]);
    mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const evilCursor = Buffer.from(
      'Wed Dec 31 1969 19:30:00 GMT-0430 (Some Timezone)|11111111-1111-1111-1111-111111111111',
      'utf8',
    ).toString('base64url');

    const res = await GET(new Request(`http://localhost/api/v1/contacts?cursor=${evilCursor}`));
    expect(res.status).toBe(200);
    expect(orCalls).toEqual([]);
  });

  it('a legitimate, server-issued cursor still works exactly as before (no regression)', async () => {
    const { supabase, orCalls } = fakeSupabase([contact('c2', '2026-01-01T00:00:00Z')]);
    mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const realCursor = Buffer.from(
      '2026-01-01T00:00:00Z|11111111-1111-1111-1111-111111111111',
      'utf8',
    ).toString('base64url');

    const res = await GET(new Request(`http://localhost/api/v1/contacts?cursor=${realCursor}`));
    expect(res.status).toBe(200);
    // A real cursor DOES produce exactly one .or() call — proving the
    // fix didn't also break the legitimate path.
    expect(orCalls).toHaveLength(1);
    expect(orCalls[0]).toBe(
      'created_at.lt.2026-01-01T00:00:00Z,and(created_at.eq.2026-01-01T00:00:00Z,id.lt.11111111-1111-1111-1111-111111111111)',
    );
  });
});
