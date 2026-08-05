-- ============================================================
-- 051_message_templates_account_scoped.sql
-- Rescope del UNIQUE de message_templates a account_id (auditoría
-- P1-3/DB-6: UNIQUE(user_id,name,language) nunca se rescoped a
-- account_id tras el account-sharing 017).
--
-- Problema: dos agentes del mismo tenant podían crear la plantilla
-- con el mismo nombre → se pisaban. El TODO en submit/route.ts:68-72
-- ya lo documentaba: "drop the legacy unique index on (user_id, name,
-- language) and add (account_id, name, language)".
--
-- Solución: drop del índice legacy + UNIQUE(account_id,name,language)
-- con chequeo de duplicados previo (mismo patrón de 014: falla con
-- mensaje accionable si hay filas duplicadas bajo el nuevo scope).
-- El call-site (submit/route.ts) cambia su onConflict a
-- 'account_id,name,language'. Webhook (update por meta_template_id)
-- y sync (lookup por account_id,name,language) ya no dependen del
-- índice legacy → no requieren cambios.
-- ============================================================

-- 1. Chequeo de duplicados bajo el NUEVO scope (account_id, name, language).
do $$
declare
  dupe_count int;
  sample     text;
begin
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT account_id, name, language
    FROM public.message_templates
    GROUP BY account_id, name, language
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(
      account_id::text || ' / ' || name || ' / ' || COALESCE(language, '(null)') ||
        ' (' || count || ' rows)',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT account_id, name, language, count(*) AS count
      FROM public.message_templates
      GROUP BY account_id, name, language
      HAVING count(*) > 1
    ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(account_id, name, language) on message_templates — % duplicate combination(s):\n  %\nDelete the rows you do not want to keep, then re-run migrations.',
      dupe_count, sample;
  END IF;
END $$;

-- 2. Drop del índice legacy + UNIQUE por account.
DROP INDEX IF EXISTS message_templates_user_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON public.message_templates (account_id, name, language);

-- 3. No se recrea el índice legacy: el call-site de submit/route.ts
--    pasa a usar onConflict 'account_id,name,language'.
