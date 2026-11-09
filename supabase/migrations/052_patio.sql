-- ============================================================
-- 052 — Sistema único, Fase 3: Pátio (estoque e site)
--
-- Só ACRESCENTA (nada é apagado ou renomeado):
--   1. org_papeis + org_papel()/org_socio(): papel de cada pessoa na loja
--      (socio | marketing | vendedor). Sem linha na tabela, quem é
--      dono/admin da conta-mãe conta como "socio" e os demais como
--      "vendedor" — assim ninguém perde acesso no dia em que isto entra.
--   2. patio_historico: quem mudou o quê em cada carro (só sócios leem).
--   3. regras: regras e alertas montados pela própria loja (nada vem
--      pronto; o motor que executa entra numa fase seguinte).
--   4. relatorio_modelos: modelos salvos do relatório filtrável.
--   5. veiculos: colunas novas do espelho do estoque do site
--      (marca, versão, categoria, data de entrada no pátio).
--
-- Até a virada, o estoque continua morando no Firestore do site: o Pátio
-- lê e grava lá no mesmo formato do admin atual. Estas tabelas guardam
-- só o que é do sistema (papéis, histórico, regras, relatórios).
-- ============================================================

-- 1. Papéis -------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_papeis (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  papel TEXT NOT NULL CHECK (papel IN ('socio', 'marketing', 'vendedor')),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);
ALTER TABLE org_papeis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_papeis_ler ON org_papeis;
CREATE POLICY org_papeis_ler ON org_papeis FOR SELECT TO authenticated
  USING (org_membro(org_id));
DROP POLICY IF EXISTS org_papeis_gestor ON org_papeis;
CREATE POLICY org_papeis_gestor ON org_papeis FOR ALL TO authenticated
  USING (org_gestor(org_id)) WITH CHECK (org_gestor(org_id));

CREATE OR REPLACE FUNCTION org_papel(target_org UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.papel FROM org_papeis p WHERE p.org_id = target_org AND p.user_id = auth.uid()),
    CASE
      WHEN org_gestor(target_org) THEN 'socio'
      WHEN org_membro(target_org) THEN 'vendedor'
      ELSE NULL
    END
  );
$$;
ALTER FUNCTION org_papel(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION org_papel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_papel(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION org_socio(target_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(org_papel(target_org) = 'socio', FALSE);
$$;
ALTER FUNCTION org_socio(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION org_socio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_socio(UUID) TO authenticated, service_role;

-- 2. Histórico do Pátio -------------------------------------------
CREATE TABLE IF NOT EXISTS patio_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  veiculo_site_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  quem TEXT,
  acao TEXT NOT NULL,
  campos TEXT[] NOT NULL DEFAULT '{}',
  antes JSONB,
  depois JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patio_historico_carro
  ON patio_historico (org_id, veiculo_site_id, criado_em DESC);
ALTER TABLE patio_historico ENABLE ROW LEVEL SECURITY;
-- Só sócios leem (pode conter valores de compra e dados do dono).
-- Ninguém grava pelo navegador: só o servidor (service role), depois de
-- conferir a permissão de quem salvou.
DROP POLICY IF EXISTS patio_historico_ler ON patio_historico;
CREATE POLICY patio_historico_ler ON patio_historico FOR SELECT TO authenticated
  USING (org_socio(org_id));

-- 3. Regras e alertas (montadas pela loja) ------------------------
CREATE TABLE IF NOT EXISTS regras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  gatilho TEXT NOT NULL,
  condicoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  acoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regras_org ON regras (org_id, ativo);
ALTER TABLE regras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regras_ler ON regras;
CREATE POLICY regras_ler ON regras FOR SELECT TO authenticated
  USING (org_membro(org_id));
DROP POLICY IF EXISTS regras_editar ON regras;
CREATE POLICY regras_editar ON regras FOR ALL TO authenticated
  USING (org_papel(org_id) IN ('socio', 'marketing'))
  WITH CHECK (org_papel(org_id) IN ('socio', 'marketing'));

-- 4. Modelos do relatório -----------------------------------------
CREATE TABLE IF NOT EXISTS relatorio_modelos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE relatorio_modelos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS relatorio_modelos_ler ON relatorio_modelos;
CREATE POLICY relatorio_modelos_ler ON relatorio_modelos FOR SELECT TO authenticated
  USING (org_papel(org_id) IN ('socio', 'marketing'));
DROP POLICY IF EXISTS relatorio_modelos_editar ON relatorio_modelos;
CREATE POLICY relatorio_modelos_editar ON relatorio_modelos FOR ALL TO authenticated
  USING (org_papel(org_id) IN ('socio', 'marketing'))
  WITH CHECK (org_papel(org_id) IN ('socio', 'marketing'));

-- 5. Espelho do estoque -------------------------------------------
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS versao TEXT;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS entrada_em TIMESTAMPTZ;
