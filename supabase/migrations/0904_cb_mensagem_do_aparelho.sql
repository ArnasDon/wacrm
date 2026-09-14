-- ============================================================
-- 904 — Mensagem enviada pelo APARELHO pareado (canal Evolution).
--
-- Num canal Evolution o CRM e o celular do operador compartilham a MESMA
-- conta de WhatsApp. Até aqui o webhook descartava tudo que chegasse com
-- `key.fromMe`, com o comentário "our own send, echoed back" — mas isso
-- misturava duas coisas bem diferentes:
--
--   * o eco do que o próprio CRM acabou de enviar (descartar é certo:
--     a linha já existe, gravada no momento do envio);
--   * o que o advogado digita no celular (deve aparecer no CRM, senão o
--     histórico da conversa fica pela metade e quem atende pelo sistema
--     não vê o que já foi respondido pelo aparelho).
--
-- A distinção em tempo de execução é por `message_id`: se já existe, é eco
-- nosso; se não existe, saiu do aparelho. Esta coluna guarda o resultado
-- dessa decisão para a interface poder marcar a bolha — sem ela, mensagem
-- do celular e mensagem do CRM ficam indistinguíveis, e numa conta com
-- vários atendentes no mesmo número isso importa: a equipe precisa saber
-- que aquela resposta não passou pelo sistema.
--
-- Padrão `false` e NOT NULL: todo o histórico existente foi enviado pelo
-- CRM (era a única origem possível), então o default descreve o passado
-- corretamente e nenhuma linha precisa ser reescrita.
-- ============================================================

alter table public.messages
  add column if not exists from_device boolean not null default false;

comment on column public.messages.from_device is
  'true quando a mensagem foi enviada pelo aparelho pareado (WhatsApp no celular), não pelo CRM. Só ocorre em canal Evolution, onde CRM e celular dividem a mesma conta.';

-- Índice parcial: a interface só precisa achar as poucas linhas marcadas,
-- e um índice cheio de `false` não pagaria o próprio custo.
create index if not exists messages_from_device_idx
  on public.messages (conversation_id)
  where from_device;
