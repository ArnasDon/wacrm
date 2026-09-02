# Postgres function inventory

Every function, trigger, and RPC defined across the 39 Supabase
migrations, and where its behaviour goes in the D1 port. Nothing in
this list is dropped silently — each row is either reimplemented,
replaced by an equivalent D1 construct, or explicitly deferred with a
phase number.

D1 note that shapes several rows below: **D1 has no interactive
transactions.** `db.batch()` sends multiple statements that commit
atomically, but you cannot read a value, branch on it in JavaScript,
and write inside the same transaction. Any Postgres function that did
read-then-decide-then-write has to be restructured as a single
conditional statement, or accept a race and be made idempotent.

## Triggers

| Postgres | Replacement | Phase |
| --- | --- | --- |
| `update_updated_at_column()` — BEFORE UPDATE on 8 tables | Application code. Drizzle sets `updatedAt` in the shared update helper in the Phase 3 access layer. A SQLite trigger would work, but the trigger was invisible at the call site; an explicit `.set({ updatedAt })` in one place is easier to audit. | 3 |
| `handle_new_user()` — AFTER INSERT on `auth.users`, creates account + profile with role `owner` | Post-registration hook in Better Auth. There is no Supabase `auth.users` table to hang a trigger on. The Postgres version swallowed errors (`EXCEPTION WHEN OTHERS ... RAISE WARNING`) so signup would succeed even if provisioning failed — the hook must **not** copy that: a user with no account cannot use the app, so provisioning failure fails the registration. | 2 |
| `bump_conversation_on_inbound()` — updates `last_message_at` / `unread_count` on message insert | Application code in the webhook handler, batched with the message insert via `db.batch()`. | 3 |
| `broadcast_recipient_aggregate_trigger()` / `_bcast_bump()` / `_bcast_cols_for_status()` — maintain the six broadcast counters | Application code in the send loop. The trigger fired per recipient row; the sender already processes recipients in batches, so it accumulates deltas and issues one counter UPDATE per batch. | 3 |
| `notify_conversation_assigned()` — inserts a `notifications` row on assignment | Application code in the assignment handler, batched with the conversation update. Also publishes to the Durable Object so the assignee sees it live. | 3 / 4 |
| `enforce_profile_privilege_columns()` — blocks a user editing their own `account_role` / `account_id` | Field-level allowlist in the profile update path. The trigger existed because RLS granted row-level UPDATE and could not restrict *which columns* changed; the access layer simply never accepts those two fields from client input. | 3 |
| `update_ai_configs_updated_at()`, `update_ai_knowledge_documents_updated_at()` | Same as `update_updated_at_column()`. | 3 |
| FTS generated column — `fts tsvector GENERATED ALWAYS AS (...) STORED` | Three SQLite triggers keeping `ai_knowledge_chunks_fts` (FTS5) in sync. Already written — `drizzle/0001_fts5_and_self_fks.sql`. | 1 ✅ |

## Authorization

| Postgres | Replacement | Phase |
| --- | --- | --- |
| `is_account_member(account_id, min_role)` — SECURITY DEFINER, the basis of ~150 RLS policies | `ROLE_RANK` in `src/lib/db/schema/_shared.ts` plus an `assertMember(session, accountId, minRole)` guard called at every access-layer entry point. This is the single most important row in the table: it is the replacement for row-level security, and Phase 3's isolation tests exist to prove it is never bypassed. | 3 |

## Atomic counters — direct UPDATE, no function needed

These were RPCs only because PostgREST cannot express `SET n = n + 1`.
A single SQLite UPDATE is atomic, so each becomes an inline Drizzle
statement.

| Postgres | Replacement | Phase |
| --- | --- | --- |
| `increment_automation_execution_count()` | `UPDATE automations SET execution_count = execution_count + 1` | 3 |
| `increment_flow_execution_count()` | Same against `flows`. | 3 |
| `claim_ai_reply_slot(conversation_id, max_replies)` | Conditional UPDATE — `SET ai_reply_count = ai_reply_count + 1 WHERE id = ? AND ai_reply_count < ?` — and the claim succeeded iff `meta.changes === 1`. The guard is in the WHERE clause, so no read-then-write race, and D1's lack of interactive transactions does not matter. | 3 |
| `record_webhook_failure(endpoint_id, max_failures)` | Single UPDATE with the same `CASE` that deactivates the endpoint once `failure_count + 1 >= max_failures`. Translates directly. | 3 |
| `touch_presence()` | `INSERT ... ON CONFLICT(user_id) DO UPDATE SET last_seen_at = ?`. SQLite supports upsert with the same syntax. Phase 4 additionally publishes presence to the Durable Object. | 3 / 4 |

## Multi-step writes — need care

Each of these read state, branched, then wrote. Without interactive
transactions the logic must be restructured, not transliterated.

| Postgres | Replacement | Phase |
| --- | --- | --- |
| `redeem_invitation(token_hash)` | Validates the token, moves the caller's profile to the inviter's account, and deletes their now-orphaned personal account. Restructure: resolve the invitation and the caller's current account in one read, then issue a single `db.batch()` containing the invitation `UPDATE ... WHERE accepted_at IS NULL` (the guard that makes double-redemption impossible), the profile update, and the account delete. If the invitation update reports 0 changes, the batch's other effects must be undone — so the delete moves to a follow-up call gated on the batch's result rather than sitting inside it. | 2 |
| `transfer_account_ownership(new_owner_user_id)` | Swaps `owner`/`admin` roles between two profiles and updates `accounts.owner_user_id`. All three writes go in one `db.batch()`; the caller's owner role is verified immediately before. A concurrent second transfer is possible in principle — guard the accounts UPDATE with `WHERE owner_user_id = <caller>` so the loser's batch changes 0 rows and can be detected. | 3 |
| `remove_account_member(user_id)` / `set_member_role(user_id, role)` | Straight profile UPDATEs plus an owner-role guard. Both already run server-side behind admin-only API routes, so they lose the SECURITY DEFINER wrapper and become access-layer functions. | 3 |
| `peek_invitation(token_hash)` | Anonymous read of an invitation by token hash, previously service-role. Becomes an unauthenticated access-layer read that returns only the account name and role — never the full row. | 2 |
| `create_broadcast_with_recipients(...)` | Inserts a broadcast and its recipient rows together. Becomes a `db.batch()`. **Watch D1's limits**: a large audience exceeds the statement count per batch, so recipients chunk into batches of ~100 with the broadcast row created first and `total_recipients` written last, so a partially-inserted broadcast is detectable. | 3 |
| `recompute_broadcast_counts(broadcast_id)` | Recovery path that recounts recipients by status and rewrites the six counters. Stays as a function in the access layer — one grouped SELECT plus one UPDATE. Needed more here than in Postgres, since counters are now maintained by application code that can crash mid-batch. | 3 |
| `merge_duplicate_contacts()` / `merge_duplicate_conversations()` | One-shot data-repair routines run by migrations 022 and 036. They operate on Postgres data and do **not** need porting — the D1 schema starts with the dedup unique index already in place. Their logic is only relevant to the data-migration work (see the risk register), where duplicates must be collapsed *before* import or the unique index rejects them. | n/a |

## Search

| Postgres | Replacement | Phase |
| --- | --- | --- |
| `filter_contacts_by_tags(tag_ids[], search, limit, offset)` | A Drizzle query. The `tag_id = ANY($1)` becomes `inArray(...)`, and the `RETURNS TABLE (contact contacts, total_count bigint)` shape becomes two queries (page + count) rather than one windowed query. | 3 |
| `match_ai_knowledge_fts(query, ...)` — `ts_rank` over a tsvector | FTS5 `MATCH` with `bm25()` ranking against `ai_knowledge_chunks_fts`. **Sign convention differs**: `ts_rank` returns higher-is-better, `bm25()` returns negative with more-negative better. Order ASC, or negate before merging with semantic scores. | 4 |
| `match_ai_knowledge_semantic(embedding, ...)` — pgvector `<=>` cosine distance | Cloudflare Vectorize query. Lives outside D1, so it cannot be joined to the chunk rows — query Vectorize for ids and scores, then fetch those chunks from D1 by id. | 4 |

## Not ported

| Postgres | Why |
| --- | --- |
| `ALTER PUBLICATION supabase_realtime ADD TABLE ...` | Postgres logical replication driving Supabase Realtime. Replaced wholesale by Durable Object fan-out (Phase 4). |
| `CREATE EXTENSION uuid-ossp` / `vector` | No extensions in D1. UUIDs generate in application code; vectors live in Vectorize. |
| `GRANT` / `REVOKE` / `OWNER TO postgres` | No role system in D1. The privilege boundary is now "does this code path run inside the access layer with a verified session", which is why Phase 3 makes privileged operations explicit functions rather than an implied service-role client. |
