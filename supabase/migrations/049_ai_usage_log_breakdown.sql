-- ============================================================
-- 049_ai_usage_log_breakdown.sql
--
-- AI optimization project (FASE 2 — Medición): ai_usage_log today only
-- records aggregate token counts per generateReply() call — there is no
-- way to tell whether a given interaction actually used the catalog,
-- Knowledge, both, how many tool calls it made, or (once FASE 5 lands)
-- what the routing layer decided. Without this, none of the token/
-- query optimizations that follow (resolver caching, Knowledge
-- short-circuiting, routing) can be measured objectively — see the
-- audit's Parte 21/22.
--
-- Purely additive: every new column is nullable with no default other
-- than NULL, so every existing row (written before this migration)
-- reads back as "unknown for this metric", never as a false zero/false.
-- No existing column is renamed, retyped, or dropped. No data is
-- deleted or rewritten. Safe to run multiple times (IF NOT EXISTS
-- guards throughout).
--
-- routing_decision anticipates FASE 5 (routing.ts) so that phase needs
-- no further migration — it stays NULL for every row logged before
-- routing exists, which is a truthful "routing was not applied here".
-- ============================================================

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS tool_call_count integer,
  ADD COLUMN IF NOT EXISTS catalog_attached boolean,
  ADD COLUMN IF NOT EXISTS catalog_used boolean,
  ADD COLUMN IF NOT EXISTS knowledge_retrieved boolean,
  ADD COLUMN IF NOT EXISTS knowledge_chars integer,
  ADD COLUMN IF NOT EXISTS catalog_context_chars integer,
  ADD COLUMN IF NOT EXISTS routing_decision text,
  ADD COLUMN IF NOT EXISTS knowledge_skipped_by_routing boolean,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

-- Matches the four-way classification routing.ts (FASE 5) will use.
-- NULL is explicitly allowed and is the value for every row logged
-- before routing exists, or for any call site that never adopts
-- routing (e.g. draft, if FASE 10 decides against it) — never coerced
-- to one of the four labels just to satisfy the constraint.
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_routing_decision_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_routing_decision_check
  CHECK (routing_decision IS NULL OR routing_decision IN ('catalog', 'knowledge', 'both', 'neither'));
