-- ============================================================
-- 1006 — Índices das duas consultas novas do PR #223: a SEGUNDA LINHA DE
-- DEFESA do "parar se o cliente responder" (mensagem do cliente gravada
-- DEPOIS de a espera ser estacionada) e a ESTADIA da automação presa à etapa
-- (movimento do card POSTERIOR à âncora; e a âncora da execução sem evento).
--
-- Sem eles as consultas resolvem, só devagar: a primeira varre as mensagens
-- da conversa pelo índice de `conversation_id` e filtra o resto; a segunda
-- varre os eventos da conta (`cb_automation_events_conta_idx`) e filtra por
-- card. A da estadia roda ANTES DE CADA PASSO de toda automação presa; a da
-- resposta, a cada espera marcada que acorda (Codex, 13ª rodada do PR #223).
--
-- ⚠️ O índice de `messages` é PARCIAL, e o predicado é ESPELHO dos filtros de
-- `clienteRespondeuDesde` (`sender_type = 'customer'`, `deleted_at is null`):
-- o planejador só usa índice parcial quando a consulta carrega os MESMOS
-- filtros. Há pino lendo os dois lados (`indices-1006.test.ts`).
--
-- Aditiva e idempotente; pode entrar antes ou depois do deploy — o app não
-- depende dela. `messages` é a maior tabela do banco: o CREATE INDEX segura
-- as escritas por alguns segundos (não há CONCURRENTLY dentro da transação
-- da migration).
-- ============================================================

create index if not exists messages_cliente_por_gravada_em_idx
  on public.messages (conversation_id, gravada_em desc)
  where sender_type = 'customer' and deleted_at is null;

create index if not exists cb_automation_events_por_card_idx
  on public.cb_automation_events (account_id, deal_id, tipo, criado_em desc);

create index if not exists cb_automation_events_por_contato_idx
  on public.cb_automation_events (account_id, contact_id, tipo, criado_em desc);

-- ============================================================
-- Conferência — verdade em banco VAZIO: os três índices existem.
-- ============================================================
do $$
declare
  v_faltam text[];
begin
  select array_agg(nome) into v_faltam
    from unnest(array[
      'messages_cliente_por_gravada_em_idx',
      'cb_automation_events_por_card_idx',
      'cb_automation_events_por_contato_idx'
    ]) as nome
   where not exists (
     select 1 from pg_indexes
      where schemaname = 'public' and indexname = nome
   );
  if v_faltam is not null then
    raise exception '1006: faltou índice: %', v_faltam;
  end if;
  raise notice '1006: índices da estadia e da resposta no lugar.';
end $$;
