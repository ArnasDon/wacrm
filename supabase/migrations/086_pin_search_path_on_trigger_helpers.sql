-- ============================================================
-- 086_pin_search_path_on_trigger_helpers.sql
--
-- Pin `search_path` on the four functions the Supabase linter flags
-- as `function_search_path_mutable`. All are SECURITY INVOKER
-- trigger/helper functions (low risk), but a fixed search_path is the
-- project convention for every other function and silences the lint.
--
-- Applied to production on 2026-08-27 via the Supabase MCP; recorded
-- here to keep the repo authoritative.
-- ============================================================

ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_ai_configs_updated_at() SET search_path = public;
ALTER FUNCTION public.update_ai_knowledge_documents_updated_at() SET search_path = public;
ALTER FUNCTION public._bcast_cols_for_status(text) SET search_path = public;
