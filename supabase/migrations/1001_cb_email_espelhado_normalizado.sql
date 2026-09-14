-- ============================================================
-- 1001 — o espelho do e-mail grava o MESMO texto dos dois lados.
--
-- A 1000 apara o e-mail só no caminho do ESPELHO: o gatilho campo → ficha
-- grava `btrim(value)` na ficha, mas deixa o valor do campo como chegou; e o
-- gatilho ficha → campo apara o que manda ao campo, mas deixa a ficha como
-- chegou. Quem escreve com espaço nas pontas — uma automação com
-- `{{vars.email}}` vindo do Typebot (" ana@x.com\n"), o PATCH da API v1 — deixa
-- `{{contact.campo.email}}` e a API de campos dizendo um texto e
-- `contacts.email` dizendo outro. Achado do Codex no PR #210, depois de a 1000
-- já estar aplicada (por isso migration nova, e não edição da 1000).
--
-- A saída é normalizar a LINHA DE ORIGEM, antes do espelho: dois gatilhos
-- BEFORE — um em `contacts` (e-mail), outro em `contact_custom_values` (só o
-- campo espelhado). Os AFTER da 1000 passam a receber o texto final, e o
-- `btrim` deles vira no-op.
--
-- ⚠️ A régua apara QUALQUER espaço das pontas (`[[:space:]]`: quebra de linha e
-- tabulação inclusas), não só o U+0020 do `btrim` — é o `.trim()` que a tela
-- já usa em `emailNormalizado`. E-mail vazio na ficha vira NULL. No campo,
-- valor vazio fica `''` (a linha continua existindo; o AFTER da 1000 zera o
-- e-mail da ficha a partir dela) — cancelar o INSERT faria o esvaziamento por
-- automação simplesmente não acontecer.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_email_normalizado(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(p_texto, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
$$;

-- ------------------------------------------------------------
-- Ficha: o e-mail entra aparado (e vazio vira NULL)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_email_da_ficha_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := cb_email_normalizado(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_email_da_ficha_normaliza_trigger ON public.contacts;
CREATE TRIGGER cb_email_da_ficha_normaliza_trigger
  BEFORE INSERT OR UPDATE OF email ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.cb_email_da_ficha_normaliza();

-- ------------------------------------------------------------
-- Campo espelhado: o valor entra aparado (campo comum não é tocado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_email_do_campo_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.value IS NOT NULL AND EXISTS (
    SELECT 1 FROM custom_fields
     WHERE id = NEW.custom_field_id AND espelho = 'contacts.email'
  ) THEN
    NEW.value := coalesce(cb_email_normalizado(NEW.value), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_email_do_campo_normaliza_trigger ON public.contact_custom_values;
CREATE TRIGGER cb_email_do_campo_normaliza_trigger
  BEFORE INSERT OR UPDATE OF value ON public.contact_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.cb_email_do_campo_normaliza();

-- ------------------------------------------------------------
-- O que já está gravado
-- ------------------------------------------------------------
-- A ficha primeiro: o UPDATE (profundidade 1) passa pelo BEFORE novo e pelo
-- AFTER da 1000, que leva o texto aparado ao campo. Depois, o valor que ainda
-- divergir (campo gravado com espaço por automação ou API).
UPDATE public.contacts
   SET email = email
 WHERE email IS DISTINCT FROM public.cb_email_normalizado(email);

UPDATE public.contact_custom_values v
   SET value = v.value
  FROM public.custom_fields f
 WHERE f.id = v.custom_field_id
   AND f.espelho = 'contacts.email'
   AND v.value IS DISTINCT FROM coalesce(public.cb_email_normalizado(v.value), '');

-- ------------------------------------------------------------
-- Ninguém chama direto (as duas metades, como manda o CLAUDE.md)
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.cb_email_da_ficha_normaliza() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_email_do_campo_normaliza() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_email_normalizado(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Conferências (seguras em banco vazio)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_divergentes int;
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN (
        'cb_email_da_ficha_normaliza_trigger',
        'cb_email_do_campo_normaliza_trigger')) <> 2 THEN
    RAISE EXCEPTION '1001: faltou algum dos dois gatilhos de normalização';
  END IF;

  IF public.cb_email_normalizado(E' \t ana@x.com \n') IS DISTINCT FROM 'ana@x.com'
     OR public.cb_email_normalizado('   ') IS NOT NULL THEN
    RAISE EXCEPTION '1001: a normalização não apara como a tela';
  END IF;

  IF has_function_privilege('anon', 'public.cb_email_do_campo_normaliza()', 'EXECUTE') THEN
    RAISE EXCEPTION '1001: anon ainda executa cb_email_do_campo_normaliza';
  END IF;

  -- Nenhum contato com o e-mail da ficha diferente do valor do campo
  -- (verdade trivial sem contatos). Ausência de valor conta como vazio.
  SELECT count(*) INTO v_divergentes
    FROM public.contacts c
    JOIN public.custom_fields f
      ON f.account_id = c.account_id AND f.espelho = 'contacts.email'
    LEFT JOIN public.contact_custom_values v
      ON v.contact_id = c.id AND v.custom_field_id = f.id
   WHERE coalesce(c.email, '') <> coalesce(v.value, '');
  IF v_divergentes > 0 THEN
    RAISE EXCEPTION '1001: % contatos com o e-mail da ficha diferente do campo', v_divergentes;
  END IF;
END $$;
