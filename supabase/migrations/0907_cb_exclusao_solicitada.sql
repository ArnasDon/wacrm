-- ============================================================
-- 907 — separar "pedimos para apagar" de "foi apagada".
--
-- Até aqui o CRM gravava `deleted_at` assim que a Evolution respondia 2xx —
-- e 2xx ali significa apenas "recebi seu pedido", nunca "revoguei no
-- aparelho do cliente". O WhatsApp não devolve confirmação de revogação: a
-- ÚNICA confirmação que existe é o webhook `messages.delete` chegando de
-- volta. Resultado em produção: mensagens marcadas "APAGADA" no CRM
-- continuavam íntegras no celular do cliente. Para um escritório, essa é a
-- afirmação mais cara que o sistema pode fazer errado.
--
-- A partir daqui:
--   `delete_requested_at`  o CRM PEDIU a revogação (o que sabemos)
--   `deleted_at`           o WhatsApp CONFIRMOU pelo webhook (o que é fato)
--
-- Os dois riscam a bolha; só o segundo escreve "Apagada".
--
-- ⚠️ Esta migration é só DDL. As linhas que HOJE têm `deleted_at` foram
-- todas marcadas pela rota antiga, sem confirmação nenhuma — conferido no
-- banco de produção em 27/07/2026: em 187 mensagens não existe UMA exclusão
-- vinda do webhook, porque a instância da Evolution nunca assinou
-- `MESSAGES_DELETE`. Reclassificá-las é reescrita de histórico e exige
-- autorização explícita do operador; por isso NÃO está aqui.
-- ============================================================

alter table messages
  add column if not exists delete_requested_at timestamptz;

comment on column messages.delete_requested_at is
  'Quando o CRM pediu a revogação ao provedor. NÃO é confirmação de que a mensagem sumiu do aparelho do destinatário — a confirmação é o webhook messages.delete preencher deleted_at.';

comment on column messages.deleted_at is
  'Exclusão CONFIRMADA pelo provedor (webhook messages.delete). Pedido sem confirmação vive em delete_requested_at.';

-- Índice parcial: a fila de "pedi e nunca confirmaram" é o que o operador
-- precisa conseguir olhar, e é minúscula perto da tabela inteira.
create index if not exists messages_delete_pendente_idx
  on messages (conversation_id, delete_requested_at)
  where delete_requested_at is not null and deleted_at is null;
