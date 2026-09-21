-- ============================================================
-- 051_bloco_3a_handoff_nao_silencioso.sql — o agente comercial deixa
-- de ficar mudo assim que chama a equipa.
--
-- Contexto (Ricardo, 21/09/2026, correcção 3): até aqui, sempre que o
-- modo comercial chamava a equipa (handoff), `conversations.
-- ai_autoreply_disabled` passava a `true` e o auto-reply desligava-se
-- para sempre nessa conversa (ver o gate em src/lib/ai/auto-reply.ts,
-- linha `if (conv.ai_autoreply_disabled) return`). Isto deixava o lead
-- a falar sozinho enquanto ninguém da equipa respondia.
--
-- A partir de agora (src/lib/ai/auto-reply.ts):
--   - Chamar a equipa em modo comercial marca
--     `conversations.team_requested_at` (esta coluna), mas NÃO desliga
--     o auto-reply — o agente continua a responder normalmente,
--     sabendo (via o prompt, teamAlreadyRequested) que já chamou
--     alguém.
--   - O agente só se cala quando um humano da equipa escreve
--     efectivamente na conversa — src/lib/whatsapp/send-message.ts
--     passa a desligar `ai_autoreply_disabled` nesse momento (uma
--     mensagem `sender_type = 'agent'`), não no momento do handoff.
--
-- O modo interno (números da equipa) não é afectado por esta
-- migração — continua a desligar o auto-reply logo no handoff, como
-- sempre fez.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS team_requested_at timestamptz;

COMMENT ON COLUMN conversations.team_requested_at IS
  'Quando o agente comercial chamou a equipa pela última vez nesta conversa (Bloco 3-A). Ao contrário de ai_autoreply_disabled, NÃO desliga o auto-reply — só um humano a escrever na conversa o faz (ver send-message.ts).';
