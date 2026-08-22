-- ============================================================
-- 080_envios_lotes_variantes.sql — N lotes configuráveis + variantes
-- A/B/C de mensagem para Envios (generaliza migration 078/079).
--
-- Duas mudanças de schema:
--
--   1. envio_lotes.numero_lote deixa de ser travado em {1,2} — passa a
--      aceitar 1..20 (mesmo teto MAX_LOTES em
--      src/lib/envios/lote-engine.ts). O restante do desenho (status
--      por lote persistido em `envio_lotes.status`, trigger de "um
--      lote ativo por conta" — check_single_active_lote, migration
--      078 — e o bloqueio sequencial entre lotes) já era genérico e
--      não muda: um lote continua bloqueado até todo lote de número
--      menor estar `concluido` (ver isLoteBlocked).
--
--   2. Variantes de mensagem (A/B/C+): o upload aceita agora um array
--      `messages` no lugar (ou além) da mensagem única por lead,
--      distribuído em rodízio dentro de cada lote. O texto original de
--      cada variante fica em `envios.variantes_mensagem` (auditoria/
--      exibição na UI); qual variante coube a cada lead fica em
--      `envio_leads.variante_indice` (índice 0-based dentro do array
--      acima). Upload legado (recipients[i].message por lead, sem
--      variantes) continua funcionando sem mudança — ambas as colunas
--      novas ficam NULL nesse caso.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE envio_lotes DROP CONSTRAINT IF EXISTS envio_lotes_numero_lote_check;
ALTER TABLE envio_lotes ADD CONSTRAINT envio_lotes_numero_lote_check
  CHECK (numero_lote BETWEEN 1 AND 20);

ALTER TABLE envios ADD COLUMN IF NOT EXISTS variantes_mensagem JSONB;

ALTER TABLE envio_leads ADD COLUMN IF NOT EXISTS variante_indice SMALLINT;
ALTER TABLE envio_leads DROP CONSTRAINT IF EXISTS envio_leads_variante_indice_check;
ALTER TABLE envio_leads ADD CONSTRAINT envio_leads_variante_indice_check
  CHECK (variante_indice IS NULL OR variante_indice >= 0);
