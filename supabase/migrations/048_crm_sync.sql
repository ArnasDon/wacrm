-- ============================================================
-- 048_crm_sync.sql — sincronização unidirecional com o Twenty CRM
--
-- Quando uma conversa nasce de um clique num anúncio Meta
-- (conversations.source = 'meta_ad', ver persistAdReferral em
-- src/app/api/whatsapp/webhook/route.ts), o EterWA cria a Pessoa
-- correspondente no Twenty CRM (nome + telefone, ver
-- src/lib/crm/sync.ts). É uma ligação NUM SÓ SENTIDO: EterWA escreve
-- no Twenty, nunca lê nem sincroniza o inverso.
--
-- Duas colunas novas:
--   1. ai_configs.crm_sync_enabled — interruptor por conta, omissão
--      false. Sem ele ligado explicitamente, nada muda: zero chamadas
--      ao Twenty.
--   2. conversations.crm_person_id — guarda o id da Pessoa criada no
--      Twenty, para nunca duplicar (verificado antes de criar — ver
--      syncMetaAdLeadToCrm).
--
-- Idempotente — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS crm_sync_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS crm_person_id text;
