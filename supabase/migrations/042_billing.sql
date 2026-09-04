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
-- `current_user = 'authenticated'` is the reliable discriminator
-- (same reasoning as 034_fix_profiles_update_rls.sql): every
-- sanctioned writer to these columns is either the service-role
-- client from the billing routes/webhook (runs as `service_role`)
-- or, in the future, a SECURITY DEFINER RPC owned by `postgres` —
-- neither is `authenticated`. Only PostgREST's browser/session
-- clients run as `authenticated`. RAISE EXCEPTION (not a silent
-- revert) so a mistaken or malicious write fails loudly instead of
-- looking like it succeeded.
CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.subscription_status        IS DISTINCT FROM OLD.subscription_status
      OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at
      OR NEW.asaas_customer_id       IS DISTINCT FROM OLD.asaas_customer_id
      OR NEW.asaas_subscription_id   IS DISTINCT FROM OLD.asaas_subscription_id
      OR NEW.subscription_updated_at IS DISTINCT FROM OLD.subscription_updated_at)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'billing columns cannot be changed directly; use the billing subscribe/cancel/webhook routes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION protect_billing_columns() OWNER TO postgres;

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

-- ============================================================
-- Manual validation (run against a live instance — no automated
-- SQL test harness exists in this repo):
--
--   1. As an `authenticated` JWT via PostgREST, this must return
--      42501 (insufficient_privilege):
--        PATCH /rest/v1/accounts?id=eq.<self> { "subscription_status": "active" }
--   2. A self-service edit that leaves all 5 billing columns alone
--      must still succeed:
--        PATCH /rest/v1/accounts?id=eq.<self> { "name": "New Name" }
--   3. The billing routes (subscribe/cancel/webhook), which use the
--      service-role client, must still be able to write all 5 columns.
--   4. A direct `UPDATE accounts SET subscription_status = ...` run
--      as `postgres` (e.g. the Supabase SQL editor) must succeed —
--      this is the manual escape hatch for a stuck webhook.
-- ============================================================
