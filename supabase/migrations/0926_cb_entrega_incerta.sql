-- ============================================================
-- 926 — "Falhou" nem sempre quer dizer "não saiu" (F4, achado das revisões)
--
-- A 925 deixou `status = 'failed'` significar duas coisas incompatíveis, e a
-- tela oferece "Tentar de novo" para as duas:
--
--   1. NÃO SAIU — canal removido, texto recusado, rede caiu antes do envio.
--      Retentar é exatamente o certo.
--   2. SAIU E NÃO FOI GRAVADO — e aqui retentar manda a MESMA mensagem duas
--      vezes para o cliente. Dois caminhos reais chegam nesse estado:
--        · `db_error` em `send-message.ts`, cuja própria mensagem diz
--          "Message sent to Meta but failed to save to DB";
--        · tempo esgotado na Evolution — abortar do nosso lado NÃO cancela o
--          envio, e isso já está registrado no projeto.
--
-- O desenho da 925 recusa retentativa a partir de `sending` por este mesmo
-- motivo, e deixou o buraco aberto do outro lado. Esta coluna fecha.
--
-- ⚠️ Coluna nova em vez de valor novo no CHECK de `status`: as duas
-- informações são independentes. "Falhou" continua sendo a situação; "pode
-- ter saído" é uma ressalva sobre ela, e quem lê o status não precisa
-- aprender um terceiro valor para continuar funcionando.
-- ============================================================

ALTER TABLE cb_scheduled_messages
  ADD COLUMN IF NOT EXISTS entrega_incerta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cb_scheduled_messages.entrega_incerta IS
  'O envio falhou DEPOIS de o WhatsApp já ter aceitado a mensagem. Retentar mandaria duas vezes ao cliente, então a tela não oferece o botão — só gente decide, olhando a conversa.';

-- Índice não: a coluna só é lida junto com a linha que já foi encontrada por
-- conversa ou por id. Um índice aqui pagaria escrita sem pagar leitura.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'cb_scheduled_messages'
       AND column_name = 'entrega_incerta'
       AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '926: entrega_incerta não ficou NOT NULL DEFAULT false.';
  END IF;

  -- A 925 revogou INSERT/UPDATE de `authenticated`; coluna nova não pode ter
  -- reaberto nada (privilégio de coluna é separado do de tabela).
  IF has_column_privilege('authenticated', 'public.cb_scheduled_messages', 'entrega_incerta', 'UPDATE') THEN
    RAISE EXCEPTION '926: authenticated pode escrever na coluna nova.';
  END IF;
END $$;
