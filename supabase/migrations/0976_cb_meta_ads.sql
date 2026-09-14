-- 976_cb_meta_ads.sql
--
-- Funil comercial, Fase 4 (docs/PLANO-funil-comercial.md): a integração com
-- o Meta Ads (Marketing API) — decisão do operador em 2026-09-03: o
-- investimento começa DIRETO pela API, em Configurações → Integrações, sem
-- lançamento manual. Três tabelas:
--
-- 1) `cb_meta_ads_config` — UMA linha por conta: a conta de anúncios
--    (`act_…`) e o token de usuário de sistema, CIFRADO com `encrypt()` de
--    `src/lib/whatsapp/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` —
--    ⚠️ rotacionar a chave invalida este token junto com os do WhatsApp).
--    ⚠️ FECHADA para `authenticated`: nenhuma policy, nenhum GRANT. O que
--    a tela precisa vem pela rota `GET /api/cb/meta-ads` (admin, service
--    role), e o token NUNCA sai de rota nenhuma, nem mascarado.
-- 2) `cb_meta_ads_campanhas` — as campanhas da conta e a que FUNIL cada uma
--    pertence (`pipeline_id` NULO = "sem funil"). É o que amarra gasto →
--    funil no Desempenho. SELECT para o membro; escrita SÓ pela API.
-- 3) `cb_meta_ads_gastos` — o gasto por DIA e por campanha, como a Meta
--    devolve (`time_increment=1`). Chave (conta, campanha, dia): a
--    sincronização reescreve os últimos 3 dias porque a Meta reprocessa o
--    gasto de ontem por até 48h. SELECT para o membro; escrita SÓ pela API.
--
-- Escrita "só pela API" = sem policy de INSERT/UPDATE/DELETE e com REVOKE
-- explícito (o padrão de `cb_tasks`): um `.update()` do navegador leva 42501,
-- que é o que tem de acontecer. `anon` sem nada, como manda a 931.

-- ---------------------------------------------------------------------------
-- 1) config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_meta_ads_config (
  account_id     uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id  text NOT NULL CHECK (ad_account_id ~ '^act_[0-9]+$'),
  access_token   text NOT NULL,
  nome_da_conta  text,
  moeda          text,
  status         text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'erro')),
  last_sync_at   timestamptz,
  last_error     text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_meta_ads_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_meta_ads_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_meta_ads_config TO service_role;

-- ---------------------------------------------------------------------------
-- 2) campanhas → funil
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_meta_ads_campanhas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id   text NOT NULL,
  nome          text NOT NULL,
  status_meta   text,
  pipeline_id   uuid,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, campaign_id),
  -- Composta com a conta (como a 908 fez em `deals`): a escrita é service
  -- role e ignora RLS, então FK simples só garantiria "existe um funil com
  -- esse id" — de qualquer conta. Coluna NOMEADA no SET NULL (lição da 966).
  CONSTRAINT cb_meta_ads_campanhas_pipeline_fkey
    FOREIGN KEY (pipeline_id, account_id)
    REFERENCES pipelines (id, account_id)
    ON DELETE SET NULL (pipeline_id)
);

CREATE INDEX IF NOT EXISTS cb_meta_ads_campanhas_funil_idx
  ON cb_meta_ads_campanhas (account_id, pipeline_id);

ALTER TABLE cb_meta_ads_campanhas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cb_meta_ads_campanhas_select ON cb_meta_ads_campanhas;
CREATE POLICY cb_meta_ads_campanhas_select ON cb_meta_ads_campanhas
  FOR SELECT USING (is_account_member(account_id));
REVOKE ALL ON TABLE cb_meta_ads_campanhas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_meta_ads_campanhas TO authenticated;
GRANT ALL ON TABLE cb_meta_ads_campanhas TO service_role;

-- ---------------------------------------------------------------------------
-- 3) gasto por dia e campanha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_meta_ads_gastos (
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id    text NOT NULL,
  dia            date NOT NULL,
  gasto          numeric(12,2) NOT NULL DEFAULT 0 CHECK (gasto >= 0),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, campaign_id, dia)
);

CREATE INDEX IF NOT EXISTS cb_meta_ads_gastos_dia_idx
  ON cb_meta_ads_gastos (account_id, dia);

ALTER TABLE cb_meta_ads_gastos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cb_meta_ads_gastos_select ON cb_meta_ads_gastos;
CREATE POLICY cb_meta_ads_gastos_select ON cb_meta_ads_gastos
  FOR SELECT USING (is_account_member(account_id));
REVOKE ALL ON TABLE cb_meta_ads_gastos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_meta_ads_gastos TO authenticated;
GRANT ALL ON TABLE cb_meta_ads_gastos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_meta_ads_config', 'cb_meta_ads_campanhas', 'cb_meta_ads_gastos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '976: tabela % ausente', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '976: anon ainda alcança %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '976: authenticated escreve em % — a escrita é só pela API', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '976: service_role sem INSERT em %', t;
    END IF;
  END LOOP;

  -- O token fica atrás da rota: nem SELECT para o membro.
  IF has_table_privilege('authenticated', 'public.cb_meta_ads_config', 'SELECT') THEN
    RAISE EXCEPTION '976: authenticated lê cb_meta_ads_config (o token cifrado sairia pelo PostgREST)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_meta_ads_campanhas', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_meta_ads_gastos', 'SELECT') THEN
    RAISE EXCEPTION '976: authenticated sem SELECT em campanhas/gastos — o Desempenho não leria o investimento';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_meta_ads_campanhas_pipeline_fkey') THEN
    RAISE EXCEPTION '976: FK composta campanha → funil ausente';
  END IF;
END $$;
