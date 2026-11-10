-- ============================================================
-- 054 — Dividir uma campanha entre carros
--
-- Uma campanha do Meta pode ter anúncios de carros diferentes, ou um
-- anúncio com mais de um carro. Dois jeitos de dividir o gasto:
--   - divisao = 'anuncio': cada anúncio vai para um carro (ou finalidade) e
--     o gasto de cada carro é o gasto real do anúncio, dia a dia, vindo do
--     Facebook (tr_ads + tr_ad_metrics_daily).
--   - divisao = 'manual': a campanha é repartida entre carros por peso
--     (partes iguais ou porcentagem) em tr_campaign_split.
-- Sem divisão (NULL) nada muda: vale o car_id da campanha, como antes.
--
-- Aditivo e idempotente — não altera nem apaga nada existente.
-- ============================================================

ALTER TABLE tr_campaigns ADD COLUMN IF NOT EXISTS divisao TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tr_campaigns_divisao_chk') THEN
    ALTER TABLE tr_campaigns ADD CONSTRAINT tr_campaigns_divisao_chk CHECK (divisao IS NULL OR divisao IN ('anuncio', 'manual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tr_campaign_split (
  campaign_id UUID NOT NULL REFERENCES tr_campaigns(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  peso NUMERIC(9,4) NOT NULL CHECK (peso > 0),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, car_id)
);
CREATE INDEX IF NOT EXISTS tr_campaign_split_org_idx ON tr_campaign_split (org_id);

CREATE TABLE IF NOT EXISTS tr_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES tr_campaigns(id) ON DELETE CASCADE,
  external_ad_id TEXT NOT NULL,
  nome TEXT,
  conjunto TEXT,
  status TEXT,
  car_id UUID REFERENCES veiculos(id) ON DELETE SET NULL,
  categoria_objetivo TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, external_ad_id)
);
CREATE INDEX IF NOT EXISTS tr_ads_campanha_idx ON tr_ads (campaign_id);

CREATE TABLE IF NOT EXISTS tr_ad_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ad_id UUID NOT NULL REFERENCES tr_ads(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  gasto NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  msgs INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_id, data)
);
CREATE INDEX IF NOT EXISTS tr_ad_metrics_org_idx ON tr_ad_metrics_daily (org_id, data);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tr_campaign_split', 'tr_ads', 'tr_ad_metrics_daily'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_gestor', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (org_gestor(org_id)) WITH CHECK (org_gestor(org_id))',
      t || '_gestor', t
    );
  END LOOP;
END $$;
