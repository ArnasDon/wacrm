-- ============================================================
-- 902_cb_conversation_channel.sql — vínculo conversa ↔ canal
--
-- Adiciona o vínculo "por qual número esta conversa responde" e o carimbo
-- "por qual número cada mensagem passou". Tudo NULO por padrão, então toda
-- conversa/mensagem existente segue funcionando igual (NULL = usa o canal
-- padrão da conta).
--
-- MODELO (ver plano):
--   conversations.channel_id      → canal por onde a conversa responde.
--   conversations.channel_pinned  → o atendente fixou o canal na mão.
--       Enquanto FALSE, o inbound atualiza channel_id para o canal por onde o
--       cliente escreveu por último ("segue o cliente"). Quando o atendente
--       escolhe no seletor, vira TRUE e o inbound para de sobrescrever.
--   messages.channel_id           → canal por onde AQUELA mensagem entrou/saiu.
--       É o que permite correlacionar ACK e reconstruir o histórico por canal.
--
-- Mantém-se UMA conversa por contato (o índice de dedupe da 036 fica intacto):
-- o requisito é um seletor de canal dentro da conversa, não threads separadas.
--
-- ON DELETE SET NULL: apagar um canal não apaga conversas/mensagens — elas
-- apenas voltam a resolver para o canal padrão.
--
-- Idempotente.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel_pinned boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- Índices parciais: só as linhas que já têm canal atribuído entram no índice
-- (a esmagadora maioria começa NULL). Servem ao ON DELETE SET NULL e a
-- consultas "conversas/mensagens deste canal".
CREATE INDEX IF NOT EXISTS conversations_channel_idx
  ON conversations (channel_id) WHERE channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_channel_idx
  ON messages (channel_id) WHERE channel_id IS NOT NULL;

COMMENT ON COLUMN conversations.channel_id IS
  'Canal por onde a conversa responde. NULL = canal padrão da conta.';
COMMENT ON COLUMN conversations.channel_pinned IS
  'TRUE = atendente fixou o canal; inbound para de sobrescrever channel_id.';
COMMENT ON COLUMN messages.channel_id IS
  'Canal por onde esta mensagem entrou/saiu. NULL = canal padrão (histórico).';
