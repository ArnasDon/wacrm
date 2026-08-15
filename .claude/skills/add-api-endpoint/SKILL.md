---
name: add-api-endpoint
description: Scaffold a new /api/v1 public REST API route (or a method on an existing one) following this repo's auth, response-envelope, pagination, and scope conventions. Use when the user asks to add or extend a public API endpoint.
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit
argument-hint: "<METHOD> /api/v1/<resource>[/[id]]"
---

# Add Public API Endpoint

Scaffold a new `/api/v1` route. Full conventions in `.claude/rules/api-v1-routes.md` — read it first if you haven't this session.

## Arguments

- `$ARGUMENTS` — e.g. `GET /api/v1/tags`, `POST /api/v1/contacts/[id]/notes`. Infer resource shape and whether it's a list, a single-item, or a nested sub-resource from the path.

## Instructions

### 1. Look at the closest existing route for shape

- Simple list + create: `src/app/api/v1/contacts/route.ts`
- Item by id: `src/app/api/v1/contacts/[id]/route.ts`
- Nested sub-resource: `src/app/api/v1/conversations/[id]/messages/route.ts`

Read whichever is closest before writing — match its structure, don't invent a new one.

### 2. Decide the scope

Check `src/lib/api-keys/scopes.ts` for an existing scope that fits (`<resource>:read` / `<resource>:write` / a verb like `messages:send`). If none fits, add one:

1. Add the string to `API_SCOPES` and its entry to `SCOPE_DESCRIPTIONS` in `src/lib/api-keys/scopes.ts`.
2. Add a row to the scopes table in `docs/public-api.md`.

### 3. Write the route file

`src/app/api/v1/<resource>/route.ts` (or `[id]/route.ts`):

```ts
// ============================================================
// GET  /api/v1/<resource>  — <what it does>  (scope: <resource>:read)
// POST /api/v1/<resource>  — <what it does>  (scope: <resource>:write)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, '<resource>:read');
    const { limit, cursor } = parseListParams(request);

    let query = ctx.supabase
      .from('<table>')
      .select('<SELECT>')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/<resource>] list error:', error);
      return fail('internal', 'Failed to list <resource>', 500);
    }

    const { items, nextCursor } = buildPage(data ?? [], limit);
    return okList(items.map(serialize<Resource>), nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
```

For a create/update handler, validate the body manually (see `contacts/route.ts`'s `POST` for the pattern — typeof checks, not a schema library) and return `ok(data, 201)` / `ok(data, 200)`.

### 4. Add a serializer

In `src/lib/api/v1/<resource>.ts`, whitelist the fields returned to callers — never spread a raw Supabase row into the response. Follow `serializeContact` in `src/lib/api/v1/contacts.ts` as the template.

### 5. Update the docs

Add the endpoint to `docs/public-api.md` (method, path, scope, request/response shape) — that file is the user-facing contract and doesn't auto-derive from code.

### 6. Verify

```bash
npm run typecheck
npm test
```

## Example Usage

```
/add-api-endpoint GET /api/v1/tags
/add-api-endpoint POST /api/v1/contacts/[id]/notes
```
