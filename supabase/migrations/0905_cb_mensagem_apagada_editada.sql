-- ============================================================
-- 905 — Mensagem apagada e mensagem editada.
--
-- ⚠️ NOTA DE NUMERAÇÃO: existem DUAS migrations 904 aplicadas
-- (`904_cb_mensagem_do_aparelho` e `904_cb_grupos`), criadas em paralelo
-- por duas frentes de trabalho no mesmo dia. O banco está consistente — o
-- Supabase versiona por timestamp, não pelo nome do arquivo — e a regra do
-- projeto proíbe renumerar migration já aplicada, então as duas ficam. Esta
-- é a 905 para não agravar a colisão.
--
-- DECISÃO DE PRODUTO, e ela DIVERGE do WhatsApp de propósito:
-- mensagem apagada NÃO some do CRM. Ela fica visível, riscada, com o
-- conteúdo legível. No WhatsApp o conteúdo evapora para todo mundo; aqui o
-- escritório precisa do registro do que foi dito, inclusive do que o cliente
-- apagou. O operador escolheu isso conscientemente, ciente da implicação de
-- guardar conteúdo que a outra parte quis remover.
--
-- Por isso NÃO existe coluna "apagar de verdade": o texto continua em
-- `content_text`. `deleted_at` é só uma marca de exibição.
-- ============================================================

alter table public.messages
  add column if not exists deleted_at timestamptz,
  -- Quem apagou. 'customer' = o cliente apagou no WhatsApp dele;
  -- 'agent' = alguém apagou pelo CRM ou pelo celular pareado. A bolha usa
  -- isto para dizer "apagada pelo cliente" vs "você apagou".
  add column if not exists deleted_by text
    check (deleted_by is null or deleted_by in ('customer', 'agent')),
  add column if not exists edited_at timestamptz,
  -- Texto ANTERIOR à última edição. Num escritório, saber o que estava
  -- escrito antes vale mais que economizar uma coluna — e é o único
  -- registro, já que o WhatsApp não guarda histórico de edição.
  add column if not exists text_before_edit text;

comment on column public.messages.deleted_at is
  'Marca de exibição: a mensagem foi apagada no WhatsApp. O conteúdo PERMANECE em content_text de propósito — o CRM mostra riscado em vez de esconder.';
comment on column public.messages.deleted_by is
  'customer = o cliente apagou; agent = apagada pelo CRM ou pelo celular pareado.';
comment on column public.messages.text_before_edit is
  'Conteúdo anterior à última edição. O WhatsApp não guarda histórico; este é o único registro.';

-- Índices parciais: as linhas marcadas são poucas, e um índice cheio de
-- NULL não pagaria o próprio custo.
create index if not exists messages_deleted_idx
  on public.messages (conversation_id)
  where deleted_at is not null;

create index if not exists messages_edited_idx
  on public.messages (conversation_id)
  where edited_at is not null;
