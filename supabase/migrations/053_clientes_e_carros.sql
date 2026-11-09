-- ============================================================
-- 053 — Sistema único, Fase 4: clientes ligados ao carro
--
-- Só ACRESCENTA (nada é apagado ou renomeado):
--   1. contacts e deals ganham o carro de interesse (id do carro no
--      estoque do site) e a origem do cliente (anúncio, site, indicação…).
--   2. visitas: agenda de visitas à loja, ligada ao cliente e ao carro.
--   3. Armazenamento PRIVADO "patio-docs" para documentos dos carros
--      (CRLV, laudo…): só sócios da loja leem e enviam.
--   4. tr_config ganha os campos das conexões opcionais (Windsor e GA4).
-- ============================================================

-- 1. Carro de interesse e origem ----------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS veiculo_site_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS origem_campanha_id UUID REFERENCES tr_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_veiculo ON contacts (account_id, veiculo_site_id) WHERE veiculo_site_id IS NOT NULL;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS veiculo_site_id TEXT;
CREATE INDEX IF NOT EXISTS idx_deals_veiculo ON deals (account_id, veiculo_site_id) WHERE veiculo_site_id IS NOT NULL;

-- 2. Visitas ------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  veiculo_site_id TEXT,
  quando TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'realizada', 'faltou', 'cancelada')),
  responsavel_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  obs TEXT,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visitas_conta_quando ON visitas (account_id, quando);
CREATE INDEX IF NOT EXISTS idx_visitas_contato ON visitas (contact_id);
ALTER TABLE visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visitas_ler ON visitas;
CREATE POLICY visitas_ler ON visitas FOR SELECT TO authenticated
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS visitas_criar ON visitas;
CREATE POLICY visitas_criar ON visitas FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS visitas_mudar ON visitas;
CREATE POLICY visitas_mudar ON visitas FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS visitas_apagar ON visitas;
CREATE POLICY visitas_apagar ON visitas FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'admin'));

-- 3. Documentos dos carros (privado) -----------------------------
-- Caminho dos arquivos: <org_id>/<id do carro>/<arquivo>
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('patio-docs', 'patio-docs', FALSE, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS patio_docs_ler ON storage.objects;
CREATE POLICY patio_docs_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'patio-docs' AND org_socio(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS patio_docs_enviar ON storage.objects;
CREATE POLICY patio_docs_enviar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patio-docs' AND org_socio(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS patio_docs_apagar ON storage.objects;
CREATE POLICY patio_docs_apagar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'patio-docs' AND org_socio(((storage.foldername(name))[1])::uuid));

-- 4. Conexões opcionais -------------------------------------------
ALTER TABLE tr_config ADD COLUMN IF NOT EXISTS windsor_api_key TEXT;  -- criptografado
ALTER TABLE tr_config ADD COLUMN IF NOT EXISTS ga4_property_id TEXT;
