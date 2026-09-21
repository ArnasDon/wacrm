-- ============================================================
-- 057_meta_capi_purchase_twenty.sql — Bloco 5: Purchase (negócio
-- ganho no Twenty CRM) → Meta Conversions API.
--
-- Context: o Bloco 4 (migrações 055/056) já reporta LeadSubmitted e
-- QualifiedLead a partir de passos da própria conversa. Este bloco
-- fecha o funil: quando um negócio passa para a fase `CLIENTE`
-- (ganho) no Twenty, o EterWA reporta `Purchase` com o valor do
-- negócio — ver src/lib/crm/twenty-purchase.ts e
-- src/lib/meta/conversions-api.ts (sendPurchaseCapiEvent). Isto dá ao
-- Gestor de Anúncios CAC e ROAS reais por anúncio, não só leads.
--
-- Esta migração só precisa de alargar o CHECK de `event_name` que já
-- existe em `meta_capi_events` (migração 056) — o resto do desenho
-- (reserva atómica por `event_id`, tabela de auditoria, sem RLS) já
-- serve o Purchase sem alteração: o dedup passa a ser por
-- `${opportunityId}:Purchase` em vez de `${conversationId}:${evento}`,
-- mas a coluna `event_id` já era um texto livre com UNIQUE, não um
-- formato imposto pelo schema.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE meta_capi_events DROP CONSTRAINT IF EXISTS meta_capi_events_event_name_check;
ALTER TABLE meta_capi_events
  ADD CONSTRAINT meta_capi_events_event_name_check
  CHECK (event_name IN ('LeadSubmitted', 'QualifiedLead', 'Purchase'));
