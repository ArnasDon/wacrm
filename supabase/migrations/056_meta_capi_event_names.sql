-- ============================================================
-- 056_meta_capi_event_names.sql — Bloco 4: corrige os nomes de evento
-- da Conversions API para os valores que a Meta aceita de facto.
--
-- Context: a migração 055 criou `meta_capi_events` com
-- event_name IN ('Lead', 'Schedule'), a nomenclatura pedida no brief
-- original. Um teste de ponta a ponta em produção (21/09/2026) mostrou
-- que a Meta rejeita os dois nomes para `action_source =
-- 'business_messaging'` (error_subcode 2804066 — "nome do evento
-- inválido"). A Conversions API for Business Messaging só aceita uma
-- lista fixa: Purchase, LeadSubmitted, InitiateCheckout, AddToCart,
-- ViewContent, OrderCreated, OrderShipped, OrderDelivered,
-- OrderCanceled, OrderReturned, CartAbandoned, QualifiedLead,
-- RatingProvided, ReviewProvided — sem eventos custom.
--
-- Decisão do Ricardo (21/09/2026): os dois sinais do Bloco 4 passam a
--   - 'LeadSubmitted' — lead qualificada (nome, email, empresa e
--     motivo completos — o antigo 'Lead').
--   - 'QualifiedLead'  — reunião comercial marcada (o antigo
--     'Schedule') — marcar reunião é o sinal mais forte de
--     qualificação que temos, por isso é este o nome que deve chegar
--     à optimização de anúncios da Meta.
--
-- Não há linhas históricas com os nomes antigos em produção neste
-- momento (a tabela só teve linhas de teste, já apagadas), mas o
-- UPDATE abaixo cobre esse caso na mesma, para o CHECK novo não falhar
-- se alguma vier a existir.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

UPDATE meta_capi_events SET event_name = 'LeadSubmitted' WHERE event_name = 'Lead';
UPDATE meta_capi_events SET event_name = 'QualifiedLead' WHERE event_name = 'Schedule';

ALTER TABLE meta_capi_events DROP CONSTRAINT IF EXISTS meta_capi_events_event_name_check;
ALTER TABLE meta_capi_events
  ADD CONSTRAINT meta_capi_events_event_name_check
  CHECK (event_name IN ('LeadSubmitted', 'QualifiedLead'));
