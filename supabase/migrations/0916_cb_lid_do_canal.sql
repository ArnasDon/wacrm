-- ============================================================
-- 916_cb_lid_do_canal — o nosso próprio LID, por canal.
--
-- POR QUE ISTO É NECESSÁRIO
-- Quando alguém marca a gente num grupo, o WhatsApp põe o JID mencionado em
-- `contextInfo.mentionedJid`. Só que, desde a migração do WhatsApp para LID,
-- esse JID vem no formato `247212345678590@lid` — um identificador interno
-- que NÃO é o telefone. Conferido em produção (Evolution 2.3.2, 2026-07-27):
-- 100% dos participantes e 100% das menções chegam em `@lid`.
--
-- Ou seja: comparar `mentionedJid` com `cb_channels.display_phone` nunca casa,
-- e `messages.mentions_us` (migration 906) ficaria FALSE para sempre — uma
-- coluna que existe e mente, que é pior do que não existir.
--
-- COMO A COLUNA É PREENCHIDA
-- Dois caminhos, ambos sem custo extra:
--   1. Oportunista, na entrada: quando o operador escreve num grupo pelo
--      celular pareado, a mensagem chega com `fromMe` e `key.participant`
--      é o NOSSO lid. Aprende-se sozinho, na primeira mensagem nossa.
--   2. Na sincronização de grupos: `findGroupInfos` devolve
--      `participants[].jid` (telefone real) ao lado de `.lid`, então dá para
--      achar a nossa linha cruzando com `display_phone`.
--
-- Enquanto for NULL, `mentions_us` fica false — degradação honesta: o
-- destaque não acende, nada quebra, e passa a funcionar sozinho depois.
--
-- Idempotente.
-- ============================================================

ALTER TABLE cb_channels
  ADD COLUMN IF NOT EXISTS own_lid text;

COMMENT ON COLUMN cb_channels.own_lid IS
  'LID do próprio número neste canal (formato 123456789@lid). Usado para detectar menções a nós em grupos, já que mentionedJid vem em LID e não em telefone. NULL = ainda não descoberto; aprendido na 1a mensagem fromMe de grupo ou na sincronização.';
