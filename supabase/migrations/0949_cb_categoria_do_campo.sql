-- ============================================================
-- 949 — Categoria do campo personalizado: geral × traqueamento
--
-- O operador pediu (2026-08-29) uma aba de TRAQUEAMENTO no painel do
-- contato: os campos de anúncio (UTMs, fbclid, ctwa_clid, nome da
-- campanha/conjunto/anúncio) precisam existir separados dos campos
-- "gerais" — eles são recebidos do clique no anúncio e, no futuro, serão
-- devolvidos à API de Conversões da Meta.
--
-- A decisão de desenho: campos de traqueamento SÃO campos personalizados
-- comuns (mesma tabela, mesma RLS, mesmos valores TEXT em
-- `contact_custom_values`), separados por UMA coluna de categoria. O que
-- isso compra, de graça: a ação de automação `update_contact_field` já
-- consegue preenchê-los, os filtros de broadcast já os enxergam, e a
-- futura API pública os lê pelo `field_key` da 948 como qualquer campo.
-- Uma tabela própria exigiria duplicar tudo isso.
--
-- ⚠️ NÃO há seed de campos aqui. O catálogo padrão (10 campos) nasce pela
-- UI — botão "Criar campos padrão" na aba, por conta — porque migration
-- não deve criar DADO por conta (banco limpo do CI ficaria com campos de
-- uma conta que não existe, e conta nova criada depois não os ganharia).
-- ============================================================

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'geral';

ALTER TABLE custom_fields
  DROP CONSTRAINT IF EXISTS cb_custom_fields_categoria_check;
ALTER TABLE custom_fields
  ADD CONSTRAINT cb_custom_fields_categoria_check
  CHECK (categoria IN ('geral', 'tracking'));

-- Sem mudança de privilégio: a coluna herda os GRANTs da tabela, e a RLS
-- (SELECT para membro, escrita para admin, da 017) continua a valer.

-- Conferência — só schema; verdadeiro num banco vazio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_fields' AND column_name = 'categoria'
      AND is_nullable = 'NO' AND column_default LIKE '%geral%'
  ) THEN
    RAISE EXCEPTION '949: categoria ausente, anulável ou sem default';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_custom_fields_categoria_check'
  ) THEN
    RAISE EXCEPTION '949: CHECK de categoria ausente';
  END IF;
END $$;
