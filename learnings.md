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
