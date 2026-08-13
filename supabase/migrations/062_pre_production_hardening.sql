-- ============================================================
-- 062_pre_production_hardening.sql — cierra los P0/P1 de la
-- auditoría pre-producción (refactor/pre-production-cleanup)
--
-- 1. notify_missed_call (045) quedó con EXECUTE abierto a
--    PUBLIC/anon/authenticated/service_role: es SECURITY DEFINER
--    y solo la invoca el trigger `on_call_missed`. Se sella con
--    el mismo patrón de trigger functions de 037 (sección 10):
--    sin EXECUTE externo alguno.
-- 2. Funciones de email_campaigns (052) heredaron los default
--    privileges (anon/authenticated). Se sellan con el patrón
--    broadcast de 037 (secciones 8 y 10): helpers y trigger
--    functions sin EXECUTE externo; el safety-net recompute queda
--    solo para service_role (engine/webhook).
-- 3. _ec_cols_for_status: pinnea search_path (advisor
--    function_search_path_mutable).
-- 4. email_templates: faltaba la política DELETE (040 solo
--    creó select/insert/update) — sin ella ningún cliente puede
--    borrar un template. Se añade con el mismo rol owner que
--    usan sus políticas insert/update.
--
-- Idempotente (REVOKE/GRANT no-op en estado ya correcto).
-- ============================================================

-- 1) notify_missed_call — trigger function, sin EXECUTE externo
REVOKE ALL ON FUNCTION public.notify_missed_call() FROM PUBLIC, anon, authenticated, service_role;

-- 2) email_campaign helpers internos + trigger function
ALTER FUNCTION public._ec_cols_for_status(text) SET search_path = public;
REVOKE ALL ON FUNCTION public._ec_cols_for_status(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._ec_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ec_bump(uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.email_campaign_recipient_aggregate_trigger() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.recompute_email_campaign_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_email_campaign_counts(uuid) TO service_role;

-- 3) email_templates — política DELETE faltante (owner, alineada con insert/update de 040)
DROP POLICY IF EXISTS email_templates_delete ON email_templates;
CREATE POLICY email_templates_delete ON email_templates FOR DELETE
  USING (is_account_member(account_id, 'owner'));