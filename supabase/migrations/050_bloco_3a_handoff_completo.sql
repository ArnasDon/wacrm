-- ============================================================
-- 050_bloco_3a_handoff_completo.sql — impede o agente comercial de
-- passar uma conversa para a equipa sem ter nome, email e motivo, e
-- sem a pessoa ter pedido explicitamente.
--
-- Contexto: até aqui, o agente comercial passava a conversa para a
-- equipa (handoff) sempre que decidia que era caso disso, sem
-- garantia nenhuma de que já sabia com quem estava a falar. Esta
-- migração acrescenta o suporte de dados que a trava de código em
-- src/lib/ai/auto-reply.ts (isCommercial branch) e
-- src/lib/ai/commercial-handoff.ts passam a exigir antes de deixar o
-- handoff avançar:
--
--   - `conversations.escalation_reason` — o motivo pelo qual a pessoa
--     quer falar com alguém da equipa, registado pela ferramenta nova
--     save_lead_details (ver src/lib/ai/tools/commercial-schema.ts).
--     `contacts.name` e `contacts.email` já existiam desde a migração
--     001 — a mesma ferramenta escreve lá.
--   - `conversations.handoff_blocked_attempts` — quantas vezes
--     seguidas o handoff foi bloqueado nesta conversa por faltarem
--     dados. Reinicia implicitamente quando o handoff acaba por
--     passar (com ou sem dados completos).
--   - `conversations.handoff_incomplete` — marca true quando o
--     handoff acabou por passar mesmo com dados em falta, pela
--     válvula de escape (ver a seguir).
--   - `ai_configs.max_handoff_blocked_attempts` — quantas tentativas
--     bloqueadas seguidas antes da válvula de escape deixar passar de
--     qualquer forma (nunca prender alguém irritado num ciclo). Por
--     omissão 2 — à terceira tentativa passa sempre, mesmo incompleta.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS escalation_reason text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_blocked_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_incomplete boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS max_handoff_blocked_attempts integer NOT NULL DEFAULT 2;
