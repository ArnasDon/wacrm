# Public API Routes (`/api/v1`)

Scope: `src/app/api/v1/**`

This is the machine-to-machine API documented for end users in [docs/public-api.md](../../docs/public-api.md) — read that file for the user-facing contract (scopes table, response shapes, pagination semantics) before changing behavior here; this rule covers the *implementation* pattern only.

## Every route follows this shape

```ts
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read'); // scope name, or omit for none
    // ctx.supabase   — service-role client (RLS-bypassing, no user session exists)
    // ctx.accountId  — MUST filter every query by this explicitly
    // ctx.scopes, ctx.keyId, ctx.createdBy

    // ... query, scoped by .eq('account_id', ctx.accountId) ...

    return ok(data);        // or okList(items, nextCursor) for a paginated list
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
```

- `requireApiKey` throws an `ApiError` on any auth failure (401 unauthorized, 403 forbidden missing scope, 429 rate_limited) — the `catch` + `toApiErrorResponse` is what turns that into the correct envelope. Every handler needs this try/catch; don't let an `ApiError` escape unhandled.
- Never call the anon/browser Supabase client here — there is no cookie session on a public-API request. Always `ctx.supabase` from `requireApiKey`.
- Rate limiting is automatic (per-key, inside `requireApiKey`, before the scope check) — don't add a second rate-limit layer in the route.

## Adding a new scope

1. Add the `resource:action` string to `API_SCOPES` and its description to `SCOPE_DESCRIPTIONS` in `src/lib/api-keys/scopes.ts`.
2. Pass it as the second argument to `requireApiKey(request, scope)` in the route(s) that need it.
3. No migration needed — scopes are stored as a free `text[]`, not an enum.
4. Add the scope to the table in `docs/public-api.md`.

## List endpoints — keyset pagination

Use `src/lib/api/v1/pagination.ts`, not offset pagination:

```ts
const { limit, cursor } = parseListParams(request);
let query = ctx.supabase.from('table').select(SELECT).eq('account_id', ctx.accountId)
  .order('created_at', { ascending: false }).order('id', { ascending: false })
  .limit(limit + 1);
const kf = keysetFilter(cursor);
if (kf) query = query.or(kf);
const { data } = await query;
const { items, nextCursor } = buildPage(data ?? [], limit);
return okList(items.map(serialize), nextCursor);
```

The double `order(created_at).order(id)` + `limit + 1` + `keysetFilter` combination is required together — dropping any one of them breaks cursor stability or the has-more detection.

## Errors

Use `fail(code, message, status)` for a domain-specific 4xx (e.g. `fail('bad_request', "'phone' is required", 400)`), and let unexpected errors fall through to `toApiErrorResponse(err)` in the `catch`. Don't invent a new response shape — every error response uses the same envelope as `fail`/`toApiErrorResponse` produce.

## Serialization

Never return a raw Supabase row. Each resource has a `serialize<Resource>()` in `src/lib/api/v1/<resource>.ts` that whitelists public fields — add new internal columns there deliberately, don't widen the `SELECT` and let them leak through.
