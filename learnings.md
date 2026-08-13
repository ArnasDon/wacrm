# Learnings

Read this file at the start of every session working on wacrm. Append to
it at the end of any session where something genuinely worth remembering
happened — a mistake, a surprising root cause, a dead end. Keep entries
short and specific; this is a log, not documentation (that belongs in
code comments or `docs/`). When the same class of mistake shows up
twice, turn it into a rule in `AGENTS.md` instead of a third log entry.

## Entries

- **Two Claude Code sessions can be working on this repo at once**
  (this cloud session + a local VS Code session). They push to the same
  `main` independently. Always `git fetch origin && git log origin/main
  -1` before starting new work, and `git merge --ff-only origin/main`
  to pick up what the other session already shipped — don't assume your
  local checkout is current just because it was a minute ago. Don't
  reapply work that already landed; check `git log origin/main..HEAD`
  (or the reverse) first.

- **External catalogue connectors: verify table/column names against
  the real schema before trusting `field_mapping`.** The LC Fitness
  external Supabase source had `field_mapping` pointing at tables
  (`stock_variations`, `store_products`) that don't exist in the real
  schema — the actual tables were `stock_products_v2` / `product_variants`.
  A migration's "sensible default" for a field mapping is a guess, not
  a fact; ask for `information_schema.columns` output before assuming
  a connector is configured correctly.

- **Portuguese grammatical gender breaks naive substring/ilike text
  search.** "branco" (masc.) doesn't match a catalogued "Branca"
  (fem.) with plain `ilike`. `src/lib/catalog/search.ts` now has
  `COLOR_SYNONYM_GROUPS` for this — check it's covering a colour before
  assuming a "customer asked for X, agent didn't find it" report is a
  prompt problem rather than a matching problem.

- **When adding a new `AgentToolKey`, there are 4 places the DB will
  reject it if you miss one**: `wacrm.agent_tools_tool_key_check` and
  `wacrm.agent_tool_calls_tool_key_check` (two separate CHECK
  constraints, easy to update one and forget the other), plus the
  TypeScript `TOOL_META`/`TOOL_COPY` records in
  `agent-flow-panel.tsx`/`agent-tools.tsx` (both `Record<AgentToolKey,
  ...>`, so `tsc` catches a missing entry — but the DB constraints
  won't, and only fail at runtime when someone actually toggles the
  tool). Grep both `_tool_key_check` constraints whenever
  `tool-permissions.ts`'s `AGENT_TOOL_KEYS` changes.

- **Migration timestamp collisions are silent until they aren't.** Two
  migrations sharing the same leading timestamp
  (`20260810140000_*.sql`) doesn't error locally, but risks colliding
  in Supabase's migration-version tracking. Check `ls
  supabase/migrations/ | sort | tail` for the actual latest timestamp
  before naming a new one, don't just take "today's date + 0000".

- **A GRANT is not implied by an RLS policy.** `ai_knowledge_documents`
  had correct RLS policies but no table-level `GRANT` to `authenticated`
  — Postgres checks privileges before RLS is even evaluated, so every
  write failed with "permission denied for table" (42501), not an RLS
  rejection. Every new `wacrm.*` migration since has an explicit
  `grant select, insert, update, delete on table wacrm.x to
  authenticated` block; older (pre-`wacrm.` schema) migrations may be
  missing this and are worth checking if a "permission denied" bug
  shows up on something old.

- **`auto-reply.test.ts`'s mocked `supabaseAdmin().from(table)` has no
  default case that returns `{data, error}` for an unrecognised table —
  its fallback branch returns a `select().eq()` chain with no second
  `.eq()` and no `.order()`.** Adding a new `db.from('some_new_table')`
  call inside `dispatchInboundToAiReply` (e.g. `loadAgentSkills`, added
  alongside `skills`) without also adding an explicit branch for it in
  this mock throws a synchronous `TypeError` while building the query
  chain — *before* any `await`, so the callee's own `if (error)`
  handling never runs. That throw escapes the `Promise.all([...])` and
  lands in `dispatchInboundToAiReply`'s outer `catch`, which sends the
  generic "não consegui concluir esta consulta" notice instead of
  calling `markHandoff` — so every test asserting a *specific* handoff
  message or `updatePayload` fails with "received null", which reads
  like the production handoff logic broke rather than "the test double
  doesn't know about a new table." Whenever a new table gets queried
  from `auto-reply.ts`, add a matching branch to this mock (mirroring
  the existing `agent_tools`/`agent_traces` ones) in the same change.

- **A field can exist in the type system and in the read/merge logic
  and still be dead, because nothing ever writes it.** LC Fitness
  catalogue products were showing `category: null` in production. The
  cause wasn't the taxonomy/matching layer — `ExternalFieldMapping.
  catalogCategory` and its use in `search.ts`'s `mergeCatalogueProduct`
  were already correct and had been for a while. The actual bug was
  that `src/components/settings/database-integrations.tsx` (the only
  place an admin can edit `field_mapping`) never had a form field for
  `catalogCategory` — so it was structurally impossible to ever set it,
  no matter how correct the read path was. When a `field_mapping.*` (or
  any admin-configured JSON) key is read somewhere but the data looks
  wrong/missing, check whether the settings UI actually exposes that
  key before assuming the bug is in the code that reads it.
