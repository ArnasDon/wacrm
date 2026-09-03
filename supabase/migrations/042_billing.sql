-- ============================================================
-- 042_billing.sql — Cobrança recorrente (Asaas)
--
-- Adiciona o estado de assinatura direto em `accounts` (já é a
-- fronteira multi-tenant desde 017_account_sharing.sql). Um trigger
-- impede qualquer escrita client-side nessas colunas — só o
-- service-role (as rotas de billing) pode gravá-las.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ;

-- Contas que já existem antes desta migração ficam `active` (default
-- acima), sem trial — não bloqueia retroativamente quem já usa o CRM.
-- Só contas criadas DEPOIS desta migração (via handle_new_user abaixo)
-- nascem em trial.

-- ============================================================
-- PROTEÇÃO — só o service-role escreve nas colunas de billing
--
-- accounts_update (017) permite admin+ editar a própria conta (hoje,
-- só o nome). Sem isso, um admin poderia chamar o client Supabase
-- direto do navegador e setar subscription_status = 'active' nele
-- mesmo, contornando o Asaas inteiro.
-- ============================================================
CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.subscription_status      := OLD.subscription_status;
    NEW.trial_ends_at            := OLD.trial_ends_at;
    NEW.asaas_customer_id        := OLD.asaas_customer_id;
    NEW.asaas_subscription_id    := OLD.asaas_subscription_id;
    NEW.subscription_updated_at  := OLD.subscription_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_billing_columns_trigger ON accounts;
CREATE TRIGGER protect_billing_columns_trigger
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION protect_billing_columns();

-- ============================================================
-- SIGNUP — novas contas nascem em trial de 7 dias
--
-- Mesma função de 017_account_sharing.sql, só adiciona
-- trial_ends_at / subscription_status = 'trialing' no INSERT.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id, subscription_status, trial_ends_at)
  VALUES (
    COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'),
    NEW.id,
    'trialing',
    NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
