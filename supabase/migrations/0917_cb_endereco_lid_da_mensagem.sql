-- ============================================================
-- 917 — o endereço @lid da conversa onde a mensagem realmente vive.
--
-- POR QUE ISTO É NECESSÁRIO
--
-- Desde o patch da Baileys (imagem evolution-api-lidfix, 28/07/2026), a
-- Evolution reescreve `key.remoteJid` de `@lid` para o telefone antes de
-- chamar o nosso webhook. Isso é ótimo para IDENTIFICAR a conversa — foi o
-- que fez as mensagens enviadas pelo celular voltarem a aparecer no CRM.
--
-- Só que, do lado do WhatsApp, a conversa continua endereçada por `@lid`. E
-- para AGIR sobre uma mensagem (revogar, editar) é preciso o endereço onde
-- ela vive, não o endereço por onde a reconhecemos.
--
-- Sintoma medido em produção em 28/07/2026: apagar pelo CRM uma mensagem que
-- o operador tinha enviado pelo CELULAR não fazia nada. O CRM marcava
-- "apagada", a Evolution respondia OK, e a mensagem seguia no aparelho —
-- porque a revogação era endereçada à conversa "telefone", e a mensagem está
-- na conversa "@lid". Mensagem enviada PELO CRM apaga normalmente: essa vive
-- na conversa "telefone" dos dois lados.
--
-- A CHAVE DA MENSAGEM NO WEBHOOK (medida, não suposta):
--   {
--     "id": "3A65CF5756657C006B64",
--     "fromMe": true,
--     "remoteJid":         "5511964102992@s.whatsapp.net",  ← reescrito
--     "previousRemoteJid": "192603597332721@lid",           ← o original
--     "senderPn":          "5511964102992@s.whatsapp.net"
--   }
--
-- `previousRemoteJid` é exatamente o dado que faltava, e ele já chega — só
-- estava sendo descartado. Esta coluna o guarda.
--
-- NULL é o caso normal e não é erro: significa "a conversa não migrou para
-- LID, ou esta mensagem não passou pela reescrita". Aí o `remote_jid` de
-- sempre é o endereço certo.
--
-- Idempotente.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS remote_jid_lid text;

COMMENT ON COLUMN messages.remote_jid_lid IS
  'Endereço @lid da conversa onde esta mensagem vive no WhatsApp, quando a Evolution reescreveu remote_jid para o telefone (key.previousRemoteJid). É este o endereço a usar para revogar ou editar; remote_jid serve para identificar a conversa. NULL = conversa não migrada para LID.';
