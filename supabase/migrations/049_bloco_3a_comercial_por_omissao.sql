-- ============================================================
-- 049_bloco_3a_comercial_por_omissao.sql — inverte a regra de quem
-- apanha o modo comercial e garante que o handoff nunca é silencioso.
--
-- Contexto: o número de WhatsApp da Eter vai estar num anúncio pago
-- (público). Até aqui, só quem clicava no anúncio (referral 'meta_ad')
-- apanhava o agente comercial; quem escrevia directamente apanhava o
-- assistente interno (Vera). Isso deixou de fazer sentido: quem
-- escreve directamente, sem ter passado pelo CRM, é também um
-- desconhecido para o negócio. A partir desta migração:
--
--   - Toda a gente apanha o modo comercial POR OMISSÃO, venha do
--     anúncio ou escreva directamente — ver isCommercialConversation
--     em src/lib/ai/commercial.ts.
--   - A ÚNICA excepção é um número que conste na lista da equipa,
--     `ai_configs.team_phone_numbers` — esses continuam a apanhar o
--     assistente interno com o `system_prompt` geral.
--   - Lista vazia (o valor por omissão) = toda a gente comercial, o
--     comportamento seguro por omissão.
--   - `commercial_mode_enabled` continua a ser o interruptor geral:
--     se estiver desligado, ninguém apanha o modo comercial (como
--     sempre foi).
--
-- `handoff_message` é a segunda peça deste bloco: a mensagem fixa que
-- o agente envia ao utilizador ANTES de se calar e passar a conversa
-- para a equipa, em qualquer dos dois modos (comercial ou interno) —
-- ver src/lib/ai/handoff.ts. Quando null, usa o valor por omissão em
-- português de Portugal definido em DEFAULT_HANDOFF_MESSAGE.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS team_phone_numbers text[] NOT NULL DEFAULT '{}';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_message text;
