-- ============================================================
-- 909_cb_saude_das_conexoes.sql — Saúde das conexões em tempo real
--
-- POR QUE ESTA MIGRATION EXISTE
-- `cb_channels.status` sozinho MENTE. Ele só muda quando o webhook
-- `connection.update` chega, ou quando alguém clica em parear/ressincronizar/
-- reparear. Se o servidor Evolution morre, ou se o webhook desaponta, nada
-- chega — e a linha segue dizendo `connected` para sempre.
--
-- Medido em produção em 2026-07-27: o canal "WhatsApp (QR Code)" estava
-- marcado `connected` com `updated_at` de 23h antes. Estava mesmo? Ninguém
-- tinha como saber. Um indicador verde lido direto de `status` seria a
-- mentira mais perigosa possível: o operador olha, vê verde, e o CRM está
-- surdo há um dia.
--
-- Daí `last_checked_at`: saúde precisa de DOIS eixos, não um —
--
--     estado reportado          ×          frescor da informação
--  (connected/connecting/…)          (quando falamos com o provedor)
--
-- O "amarelo = travado" que o operador pediu é exatamente
-- `connected` + informação velha, e só é computável com esta coluna.
--
-- ⚠️ QUEM ESCREVE `status`
-- Já eram três (webhook `connection.update`, POST /[id]/connect e
-- POST /[id]/restart). A sonda é o quarto, mas NÃO é um quarto significado:
-- ela é o PULL da mesma verdade que o webhook faz PUSH — o estado que o
-- provedor reporta. Por isso ela pode escrever `status`, e escreve junto o
-- `last_checked_at`. O que ela nunca faz é inventar estado quando não
-- conseguiu falar com o provedor: aí grava nada, e o frescor velho é que
-- conta a história.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE cb_channels ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

COMMENT ON COLUMN cb_channels.last_checked_at IS
  'Ultima vez que a sonda conseguiu falar com o provedor sobre este canal. '
  'NULL = nunca sondado. Velho demais = status nao e confiavel (amarelo).';

-- ------------------------------------------------------------
-- Realtime: a queda aparece na tela sem esperar o proximo ciclo da sonda
--
-- ⚠️⚠️ LISTA DE COLUNAS OBRIGATÓRIA — não trocar por `ADD TABLE cb_channels`.
--
-- `access_token`, `api_key` e `verify_token` moram nesta tabela, e a policy
-- de RLS libera a LINHA inteira para qualquer membro (RLS é por linha, não
-- por coluna). Toda a disciplina que impede o segredo de sair daqui está em
-- `CB_CHANNEL_SAFE_COLUMNS` (src/lib/cb-channels/repo.ts) — uma lista de
-- colunas aplicada nos SELECTs.
--
-- O Realtime não passa por SELECT nenhum: o payload é montado a partir do
-- WAL. Publicar a tabela inteira entregaria os três segredos, já
-- descriptografáveis por quem tiver a ENCRYPTION_KEY, ao browser de todo
-- atendente — e sem nenhum ponto no código onde isso ficasse visível.
--
-- A lista abaixo é o espelho de CB_CHANNEL_SAFE_COLUMNS. Coluna nova que
-- precise chegar ao browser entra nos DOIS lugares; coluna de segredo, em
-- nenhum. (Listas de coluna em publicação exigem PG 15+; este banco é 17.6.)
-- `id` é obrigatório — é a replica identity padrão.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cb_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cb_channels (
      id, account_id, kind, label, display_phone, is_default, status,
      connected_at, last_error, phone_number_id, waba_id, server_url,
      instance_name, default_pipeline_id, default_stage_id,
      last_checked_at, created_at, updated_at
    );
  END IF;
END $$;
