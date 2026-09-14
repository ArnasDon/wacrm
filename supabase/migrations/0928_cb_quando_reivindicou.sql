-- ============================================================
-- 928 — Quando a agendada foi reivindicada (F4, achado da revisão final)
--
-- ⚠️ CONSERTA UM DEFEITO INTRODUZIDO NA MESMA FASE. O recolhedor de linhas
-- travadas (dispatch.ts) media a idade por `created_at` e por `scheduled_for`,
-- porque não havia carimbo de reivindicação. Os dois são errados, e cada um em
-- uma direção:
--
--  · `created_at` é MUITO anterior à reivindicação. Uma agendada criada às 10h
--    para as 14h, reivindicada às 14h, satisfaz `created_at < agora-10min` já
--    às 14h05 — o recolhedor a marcaria como falha com o envio AINDA EM CURSO.
--    O comentário que eu escrevi afirmava o contrário ("aproximação segura na
--    direção certa"), e estava errado.
--
--  · `scheduled_for` protegia esse caso por acidente, e abria outro: o botão
--    "Executar agora" reivindica uma linha marcada para daqui a 30 dias. Se o
--    processo morrer ali, `scheduled_for` só fica no passado dali a 30 dias —
--    e até lá a linha some da tela mostrando "Enviando", sem botão nenhum, e
--    ainda trava a remoção daquela conexão de WhatsApp.
--
-- Com o carimbo, a pergunta "há quanto tempo esta linha está em `sending`?"
-- passa a ter resposta exata, e as duas aproximações somem.
-- ============================================================

ALTER TABLE cb_scheduled_messages
  ADD COLUMN IF NOT EXISTS sending_desde timestamptz;

COMMENT ON COLUMN cb_scheduled_messages.sending_desde IS
  'Quando o worker reivindicou a linha (status virou `sending`). É a ÚNICA medida correta da idade de um travamento: `created_at` é anterior demais e `scheduled_for` não vale para "Executar agora".';

-- Linhas que já estejam em `sending` neste instante não têm carimbo e ficariam
-- fora do recolhimento para sempre. Em produção são zero (a feature ainda não
-- subiu), mas a migration não pode depender disso.
UPDATE cb_scheduled_messages
   SET sending_desde = COALESCE(sending_desde, now())
 WHERE status = 'sending' AND sending_desde IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'cb_scheduled_messages'
       AND column_name = 'sending_desde'
  ) THEN
    RAISE EXCEPTION '928: a coluna sending_desde não foi criada.';
  END IF;

  -- A 925 revogou INSERT/UPDATE de `authenticated`; coluna nova não pode ter
  -- reaberto nada (privilégio de coluna é separado do de tabela).
  IF has_column_privilege('authenticated', 'public.cb_scheduled_messages', 'sending_desde', 'UPDATE') THEN
    RAISE EXCEPTION '928: authenticated pode escrever na coluna nova.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cb_scheduled_messages
     WHERE status = 'sending' AND sending_desde IS NULL
  ) THEN
    RAISE EXCEPTION '928: sobrou linha em sending sem carimbo — ela nunca seria recolhida.';
  END IF;
END $$;
