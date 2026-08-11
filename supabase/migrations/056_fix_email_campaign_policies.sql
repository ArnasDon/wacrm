-- ============================================================
-- 056_fix_email_campaign_policies.sql — las 3 políticas de escritura
-- que 052 nunca llegó a crear.
--
-- 052_email_campaigns.sql:71,74,78 escribió
--
--   DROP POLICY IF EXISTS email_campaigns_insert ON email_campaigns FOR INSERT
--     WITH CHECK (is_account_member(account_id, 'agent'));
--
-- `DROP POLICY` no admite `FOR INSERT ... WITH CHECK` — la gramática es
-- `DROP POLICY [IF EXISTS] name ON table [CASCADE|RESTRICT]`. Son errores
-- de análisis sintáctico, así que Postgres aborta el archivo en la línea 71.
-- Y aunque no abortara: en las tres sentencias falta por completo el
-- `CREATE POLICY`. Ninguna migración del repo crea las políticas de
-- INSERT/UPDATE/DELETE de `email_campaigns` (verificado con grep sobre
-- supabase/migrations/).
--
-- Consecuencia: RLS activo con SOLO política de SELECT. `email_campaigns`
-- se lee pero no se escribe desde el navegador, que es exactamente lo que
-- hacen el asistente y la lista:
--
--   src/app/(dashboard)/email/new/page.tsx:88   insert  (guardar borrador)
--   src/hooks/use-email-campaign-sending.ts:52  insert  (crear y enviar)
--   src/app/(dashboard)/email/[id]/page.tsx:222 update
--   src/components/email/email-campaigns-list.tsx:94  delete
--
-- Los cuatro usan `@/lib/supabase/client` (cliente de navegador, sujeto a
-- RLS), no el service-role. Sin estas políticas el INSERT devuelve 42501.
--
-- Mismo modelo que 017 y que la política de SELECT que sí se creó:
-- agent+ escribe las filas de su cuenta vía `is_account_member`.
--
-- Idempotente — DROP ... IF EXISTS en su propia sentencia antes de cada
-- CREATE, y seguro de correr dos veces.
-- ============================================================

DROP POLICY IF EXISTS email_campaigns_insert ON email_campaigns;
CREATE POLICY email_campaigns_insert ON email_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS email_campaigns_update ON email_campaigns;
CREATE POLICY email_campaigns_update ON email_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS email_campaigns_delete ON email_campaigns;
CREATE POLICY email_campaigns_delete ON email_campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));
