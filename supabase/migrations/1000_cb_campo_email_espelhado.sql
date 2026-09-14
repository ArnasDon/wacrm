-- ============================================================
-- 1000 — Campo personalizado "E-mail" que ESPELHA `contacts.email`.
--
-- O e-mail do cliente só existia na ficha de /contatos: na conversa do inbox
-- ninguém o via nem o editava. Decisão do operador (14/09/2026): um campo
-- "E-mail" no bloco Geral dos campos personalizados, amarrado ao e-mail da
-- ficha — editar um edita o outro —, que NÃO pode ser apagado, mas pode mudar
-- de lugar e de bloco como qualquer campo.
--
-- ⚠️ POR QUE NO BANCO, E NÃO NA TELA. `contacts.email` tem muitos escritores
-- (ficha, formulário, importação de CSV, PATCH da API v1, o passo
-- `update_contact_field` das automações, a criação de ficha do Calendly e do
-- Asaas) e o valor do campo também (as duas telas, a API v1, as automações).
-- Espelhar em código exigiria cada um deles lembrar do outro lado — a mesma
-- lição da trilha da 912, que foi para gatilho por ter 9 escritores. Aqui o
-- espelho vale para todos, e os LEITORES do valor do campo
-- (`{{contact.campo.<chave>}}`, disparos, API v1, a lista do funil) enxergam
-- o e-mail sem saber que ele é especial.
--
-- As peças:
--   1. `custom_fields.espelho` ('contacts.email' ou nulo) + um por conta.
--   2. Um campo "E-mail" semeado em cada conta, no FIM do bloco Geral, e o
--      acervo: e-mail já gravado vira valor do campo.
--   3. Dois gatilhos de espelho, um em cada tabela.
--   4. O campo espelhado não se apaga nem troca de tipo, chave ou espelho.
--   5. Conta NOVA nasce com o campo.
--
-- ⚠️ `pg_trigger_depth() > 1` nos dois gatilhos de espelho é o que separa a
-- escrita de GENTE (profundidade 1) da que veio do outro gatilho ou de uma
-- CASCATA (profundidade 2: apagar o contato cascateia o valor, e esse DELETE
-- não pode tentar zerar o e-mail de uma ficha que está saindo). A
-- terminação do eco também é garantida pelo `IS DISTINCT FROM`: um UPDATE que
-- não muda nada não casa linha, e sem linha não há gatilho.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A marca
-- ------------------------------------------------------------
ALTER TABLE public.custom_fields
  ADD COLUMN IF NOT EXISTS espelho text;

ALTER TABLE public.custom_fields
  DROP CONSTRAINT IF EXISTS cb_custom_fields_espelho_check;
ALTER TABLE public.custom_fields
  ADD CONSTRAINT cb_custom_fields_espelho_check
  CHECK (espelho IS NULL OR espelho = 'contacts.email');

-- Um campo espelhado por conta: dois fariam o e-mail da ficha oscilar entre
-- os valores dos dois a cada edição.
CREATE UNIQUE INDEX IF NOT EXISTS cb_custom_fields_espelho_por_conta_idx
  ON public.custom_fields (account_id, espelho)
  WHERE espelho IS NOT NULL;

COMMENT ON COLUMN public.custom_fields.espelho IS
  'Coluna da ficha que este campo espelha (hoje só ''contacts.email''). NULL = campo comum. O espelho é feito por gatilho nas duas tabelas, e o campo espelhado não pode ser apagado nem trocar de tipo, chave ou espelho. Ver 1000.';

-- ------------------------------------------------------------
-- 2) Semeia o campo em cada conta e traz o acervo
-- ------------------------------------------------------------
-- ANTES dos gatilhos, de propósito: o acervo não precisa ecoar de volta.
--
-- ⚠️ `user_id` = o DONO da conta, nunca outra coisa: `custom_fields.user_id`
-- cascateia de `auth.users` (ver a regra do dono durável no CLAUDE.md).
-- A chave é `email` quando está livre; ocupada (a conta já tinha um campo com
-- essa chave), o gatilho da 948 gera outra a partir do nome.
INSERT INTO public.custom_fields
  (account_id, user_id, field_name, field_type, field_key, espelho, grupo_id, posicao)
SELECT a.id,
       a.owner_user_id,
       'E-mail',
       'text',
       CASE WHEN EXISTS (
              SELECT 1 FROM public.custom_fields f
               WHERE f.account_id = a.id AND f.field_key = 'email'
            ) THEN NULL ELSE 'email' END,
       'contacts.email',
       NULL,
       (SELECT coalesce(max(f.posicao), -1) + 1
          FROM public.custom_fields f
         WHERE f.account_id = a.id AND f.grupo_id IS NULL)
  FROM public.accounts a
 WHERE NOT EXISTS (
         SELECT 1 FROM public.custom_fields f
          WHERE f.account_id = a.id AND f.espelho IS NOT NULL
       );

INSERT INTO public.contact_custom_values (contact_id, custom_field_id, value)
SELECT c.id, f.id, btrim(c.email)
  FROM public.contacts c
  JOIN public.custom_fields f
    ON f.account_id = c.account_id AND f.espelho = 'contacts.email'
 WHERE nullif(btrim(c.email), '') IS NOT NULL
ON CONFLICT (contact_id, custom_field_id)
DO UPDATE SET value = EXCLUDED.value
 WHERE public.contact_custom_values.value IS DISTINCT FROM EXCLUDED.value;

-- ------------------------------------------------------------
-- 3) O espelho
-- ------------------------------------------------------------

-- Ficha → campo
CREATE OR REPLACE FUNCTION public.cb_email_da_ficha_para_o_campo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campo uuid;
  v_email text := nullif(btrim(NEW.email), '');
BEGIN
  -- Veio do outro gatilho (campo → ficha): o valor do campo já é este.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_campo
    FROM custom_fields
   WHERE account_id = NEW.account_id AND espelho = 'contacts.email';
  IF v_campo IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_email IS NULL THEN
    DELETE FROM contact_custom_values
     WHERE contact_id = NEW.id AND custom_field_id = v_campo;
  ELSE
    INSERT INTO contact_custom_values (contact_id, custom_field_id, value)
    VALUES (NEW.id, v_campo, v_email)
    ON CONFLICT (contact_id, custom_field_id)
    DO UPDATE SET value = EXCLUDED.value
     WHERE contact_custom_values.value IS DISTINCT FROM EXCLUDED.value;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_email_da_ficha_para_o_campo_trigger ON public.contacts;
CREATE TRIGGER cb_email_da_ficha_para_o_campo_trigger
  AFTER INSERT OR UPDATE OF email ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.cb_email_da_ficha_para_o_campo();

-- Campo → ficha
CREATE OR REPLACE FUNCTION public.cb_email_do_campo_para_a_ficha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Veio do outro gatilho (ficha → campo) ou de CASCATA — contato apagado
  -- (a ficha está saindo) ou conta/campo apagados (o e-mail da ficha fica).
  -- (AFTER: o retorno é ignorado, e NULL serve para os três eventos.)
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM custom_fields
       WHERE id = OLD.custom_field_id AND espelho = 'contacts.email'
    ) THEN
      UPDATE contacts
         SET email = NULL
       WHERE id = OLD.contact_id AND email IS NOT NULL;
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1 FROM custom_fields
     WHERE id = NEW.custom_field_id AND espelho = 'contacts.email'
  ) THEN
    UPDATE contacts
       SET email = nullif(btrim(NEW.value), '')
     WHERE id = NEW.contact_id
       AND email IS DISTINCT FROM nullif(btrim(NEW.value), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_email_do_campo_para_a_ficha_trigger ON public.contact_custom_values;
CREATE TRIGGER cb_email_do_campo_para_a_ficha_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.cb_email_do_campo_para_a_ficha();

-- ------------------------------------------------------------
-- 4) O campo espelhado não se apaga nem muda de natureza
-- ------------------------------------------------------------
-- Gatilho, e não só policy: a policy de DELETE só alcança o navegador
-- (service role a ignora), e RLS que barra devolve 0 linhas SEM erro — a
-- tela diria "apagado" sobre um campo intacto. Renomear e mudar de bloco ou
-- posição continuam livres.
CREATE OR REPLACE FUNCTION public.cb_campo_espelhado_protege()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Profundidade 1 = DELETE direto. A cascata (conta apagada, dono apagado
    -- do `auth.users`) chega com profundidade 2 e passa: o campo sai junto
    -- com o que o contém.
    IF OLD.espelho IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'O campo "%" espelha o e-mail da ficha e não pode ser apagado.', OLD.field_name
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.espelho IS NOT NULL AND (
       NEW.espelho IS DISTINCT FROM OLD.espelho
    OR NEW.field_type IS DISTINCT FROM OLD.field_type
    OR NEW.field_key IS DISTINCT FROM OLD.field_key
  ) THEN
    RAISE EXCEPTION 'O campo "%" espelha o e-mail da ficha: tipo, chave e espelho não mudam.', OLD.field_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Campo comum não vira espelho por UPDATE: o espelho nasce semeado.
  IF OLD.espelho IS NULL AND NEW.espelho IS NOT NULL THEN
    RAISE EXCEPTION 'Um campo existente não pode passar a espelhar a ficha.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_campo_espelhado_protege_trigger ON public.custom_fields;
CREATE TRIGGER cb_campo_espelhado_protege_trigger
  BEFORE UPDATE OR DELETE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.cb_campo_espelhado_protege();

-- ------------------------------------------------------------
-- 5) Conta nova nasce com o campo
-- ------------------------------------------------------------
-- ⚠️ Nunca derruba a criação da conta: um cadastro que falha por causa de um
-- campo personalizado seria desproporcional. Falhando, fica um WARNING — e a
-- conta sem o campo, que é o estado de antes desta migration.
CREATE OR REPLACE FUNCTION public.cb_semeia_campo_de_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO custom_fields (account_id, user_id, field_name, field_type, field_key, espelho)
    VALUES (NEW.id, NEW.owner_user_id, 'E-mail', 'text', 'email', 'contacts.email')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '1000: conta % nasceu sem o campo de e-mail espelhado: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_semeia_campo_de_email_trigger ON public.accounts;
CREATE TRIGGER cb_semeia_campo_de_email_trigger
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.cb_semeia_campo_de_email();

-- ------------------------------------------------------------
-- 6) Ninguém chama estas funções direto
-- ------------------------------------------------------------
-- Revogar não impede o gatilho de disparar (o privilégio é checado no
-- CREATE TRIGGER). As duas metades, como manda o CLAUDE.md.
REVOKE EXECUTE ON FUNCTION public.cb_email_da_ficha_para_o_campo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_email_do_campo_para_a_ficha() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_campo_espelhado_protege() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_semeia_campo_de_email() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7) Conferências (seguras em banco vazio: só afirmam estrutura)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_contas int;
  v_semeadas int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'custom_fields' AND column_name = 'espelho'
  ) THEN
    RAISE EXCEPTION '1000: custom_fields.espelho não foi criada';
  END IF;

  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN (
        'cb_email_da_ficha_para_o_campo_trigger',
        'cb_email_do_campo_para_a_ficha_trigger',
        'cb_campo_espelhado_protege_trigger',
        'cb_semeia_campo_de_email_trigger')) <> 4 THEN
    RAISE EXCEPTION '1000: faltou algum dos quatro gatilhos';
  END IF;

  IF has_function_privilege('anon', 'public.cb_email_do_campo_para_a_ficha()', 'EXECUTE') THEN
    RAISE EXCEPTION '1000: anon ainda executa cb_email_do_campo_para_a_ficha';
  END IF;

  -- Toda conta existente ficou com o campo (verdade trivial sem contas).
  SELECT count(*) INTO v_contas FROM accounts;
  SELECT count(*) INTO v_semeadas FROM custom_fields WHERE espelho = 'contacts.email';
  IF v_semeadas <> v_contas THEN
    RAISE EXCEPTION '1000: % contas e % campos de e-mail espelhado', v_contas, v_semeadas;
  END IF;
END $$;
