-- ============================================================
-- 104_flow_fallback_default_ai.sql — new flows hand off-menu replies to the AI
--
-- When a customer reply doesn't match any option on a Flow menu node,
-- the run follows `flows.fallback_policy`. The old column default was
-- `on_unknown_reply: 'reprompt'` → after `max_reprompts`, hand to a
-- human. New flows should instead let the AI auto-reply take the
-- conversation over (the run ends; a later trigger can still start a
-- fresh one). See `src/lib/flows/fallback.ts` (`decideFallback`, the
-- new `ai` action) and `src/lib/flows/engine.ts`.
--
-- `POST /api/flows` creates a flow WITHOUT a `fallback_policy`, so a new
-- row inherits this column default. Existing rows are left untouched —
-- they already carry an explicit policy; change it per flow in the
-- builder's new fallback panel.
-- ============================================================

ALTER TABLE flows
  ALTER COLUMN fallback_policy SET DEFAULT
    '{"on_unknown_reply":"ai","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb;
