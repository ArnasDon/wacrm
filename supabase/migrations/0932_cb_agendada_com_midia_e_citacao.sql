-- ============================================================
-- 932 — A agendada passa a levar anexo e citação (Fase B)
--
-- A 925 nasceu só com texto (P4.6). Esta migration abre as duas lacunas que
-- ficaram: mandar arquivo com hora marcada, e responder a uma mensagem
-- específica.
--
-- ⚠️ O QUE ESTA MIGRATION **NÃO** PRECISOU FAZER, E POR QUÊ IMPORTA
-- Nenhum caminho de upload novo. O compositor já sobe o arquivo para o bucket
-- `chat-media` no instante em que ele é ANEXADO — antes de qualquer envio —,
-- então o rascunho já tem `mediaUrl` e `path`. Agendar mídia é guardar o que
-- hoje é descartado, não subir de novo em outro lugar.
--
-- ⚠️ E O QUE ELA DELIBERADAMENTE NÃO GARANTE: que o arquivo ainda exista na
-- hora do envio. Entre agendar e enviar passam horas; o objeto pode ter sido
-- removido. Banco nenhum sabe disso — quem confere é o disparador, com
-- `storage.exists()`, ANTES de reivindicar a linha.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Anexo
-- ------------------------------------------------------------
ALTER TABLE cb_scheduled_messages
  -- A URL pública que o transporte busca na hora do envio. É a mesma coluna
  -- que `messages.media_url` guarda depois.
  ADD COLUMN IF NOT EXISTS media_url text,
  -- O caminho do objeto no bucket (`account-<id>/<ts>-<nome>`). Serve a duas
  -- coisas que a URL não serve: conferir que o arquivo ainda existe, e apagá-lo
  -- quando a agendada é cancelada.
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_kind text,
  -- Só o documento mostra o nome ao destinatário; nas outras é enfeite.
  ADD COLUMN IF NOT EXISTS media_filename text;

COMMENT ON COLUMN cb_scheduled_messages.media_path IS
  'Caminho do objeto no bucket chat-media. Existe para (a) conferir que o arquivo ainda está lá antes de disparar e (b) apagá-lo ao cancelar. ⚠️ NÃO apagar o objeto de linha `sent`: ali ele já pertence à mensagem que está no fio do cliente.';

-- ------------------------------------------------------------
-- 2) Citação
-- ------------------------------------------------------------
ALTER TABLE cb_scheduled_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid,
  -- ⚠️ A coluna que o `NULL` sozinho não conseguiria dizer. Sem ela não há
  -- como distinguir "nunca citou" de "citava e a citada foi apagada" — e é
  -- exatamente essa distinção que o aviso da faixa precisa. Mesma lição da
  -- `entrega_incerta` (926), onde `failed` sozinho não dizia se a mensagem
  -- tinha saído.
  ADD COLUMN IF NOT EXISTS citacao_perdida boolean NOT NULL DEFAULT false;

-- ⚠️ SEM FOREIGN KEY, e as três alternativas foram descartadas com motivo:
--
--   · RESTRICT  — proibido: apagar uma mensagem passaria a falhar por causa de
--                 uma agendada que ninguém lembra que existe.
--   · CASCADE   — apagaria a agendada inteira porque a mensagem citada sumiu.
--                 O cliente deixaria de receber algo que não tem relação
--                 nenhuma com a exclusão.
--   · SET NULL  — apagaria JUSTAMENTE a informação de que houve citação, que é
--                 o que o aviso precisa. Seria preciso uma terceira coluna só
--                 para reconstruir o que a FK acabou de destruir.
--
-- E a integridade que a FK daria não está em falta:
--   1. apagar mensagem NESTE CRM é apagar MOLE (`deleted_at`, migration 905) —
--      a linha continua no banco, então não há ponteiro solto a evitar;
--   2. os caminhos que apagam linha de `messages` de verdade (apagar contato,
--      apagar conversa) cascateiam até `conversations`, e a agendada morre
--      junto pela FK composta da 925;
--   3. `messages.reply_to_message_id`, do upstream, também não tem FK — e não
--      existe índice único em `messages` que sirva de alvo COMPOSTO, que é a
--      forma que este projeto usa (903/908/918/924). Criar um índice único
--      novo numa tabela quente do upstream, para um ponteiro anulável, é
--      footprint maior que o risco.
--
-- Quem confere posse é a rota (a citada tem de ser da MESMA conversa) e, de
-- novo, `send-message.ts` no envio — que filtra por `conversation_id` antes de
-- montar a citação.
COMMENT ON COLUMN cb_scheduled_messages.reply_to_message_id IS
  '`messages.id` que esta agendada responde. Sem FK de propósito (ver a 932): apagar mensagem aqui é apagar mole, e as três formas de FK destruiriam informação em vez de proteger.';

COMMENT ON COLUMN cb_scheduled_messages.citacao_perdida IS
  'A mensagem citada já não existia (ou estava apagada) na hora do envio, e a mensagem saiu SEM a citação. Carimbado pelo disparador.';

-- Índice não: a coluna só é lida pela própria linha, nunca pesquisada.

-- ------------------------------------------------------------
-- 3) As regras de forma
-- ------------------------------------------------------------

-- ⚠️ O CHECK do corpo tem de ser AFROUXADO, e este é o ponto em que a fase
-- toca no que já estava de pé. Hoje ele exige texto não-vazio; mídia sem
-- legenda é legítima (e no áudio é obrigatória), então uma agendada de foto
-- sem legenda seria recusada pelo banco.
ALTER TABLE cb_scheduled_messages
  DROP CONSTRAINT IF EXISTS cb_scheduled_messages_body_check;

ALTER TABLE cb_scheduled_messages
  ADD CONSTRAINT cb_scheduled_messages_body_check
  CHECK (
    length(body) <= 4000
    AND (media_url IS NOT NULL OR length(btrim(body)) > 0)
  );

-- Os três campos do anexo andam juntos: ou há anexo completo, ou não há anexo.
-- Meio anexo (URL sem caminho) é uma linha que o disparador não consegue
-- conferir e o cancelamento não consegue limpar.
ALTER TABLE cb_scheduled_messages
  DROP CONSTRAINT IF EXISTS cb_scheduled_messages_media_forma_check;

ALTER TABLE cb_scheduled_messages
  ADD CONSTRAINT cb_scheduled_messages_media_forma_check
  CHECK (
    (media_url IS NULL AND media_path IS NULL AND media_kind IS NULL)
    OR (media_url IS NOT NULL AND media_path IS NOT NULL AND media_kind IS NOT NULL)
  );

-- Mesma lista de `MEDIA_KINDS` em `send-message.ts`. Um tipo fora dela chega
-- ao transporte e vira erro de provedor às 3 da manhã.
ALTER TABLE cb_scheduled_messages
  DROP CONSTRAINT IF EXISTS cb_scheduled_messages_media_kind_check;

ALTER TABLE cb_scheduled_messages
  ADD CONSTRAINT cb_scheduled_messages_media_kind_check
  CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document', 'audio'));

-- ⚠️ ÁUDIO COM CORPO VAZIO — a regra menos óbvia desta migration, e a que
-- evita uma mensagem que o CRM jura ter mandado e o cliente nunca recebeu.
-- Nota de voz sai por `message/sendWhatsAppAudio`, que NÃO tem campo de
-- legenda: o texto seria gravado em `messages.content_text`, apareceria no fio
-- para a equipe, e simplesmente não viajaria. O compositor já não oferece
-- legenda para áudio; isto é o que impede um POST fora da tela de criar a
-- linha mesmo assim.
ALTER TABLE cb_scheduled_messages
  DROP CONSTRAINT IF EXISTS cb_scheduled_messages_audio_sem_legenda_check;

ALTER TABLE cb_scheduled_messages
  ADD CONSTRAINT cb_scheduled_messages_audio_sem_legenda_check
  CHECK (media_kind IS DISTINCT FROM 'audio' OR length(btrim(body)) = 0);

-- Teto da legenda de mídia: 1024, o da Meta.
-- ⚠️ É um PARA-CHOQUE, não a validação de verdade. O teto real é 1024 MENOS o
-- custo da assinatura (923), que o banco não tem como conhecer — quem valida
-- isso é a rota, com `custoDaAssinatura`. Aqui só se impede o absurdo de uma
-- legenda de 4000 caracteres entrar como agendada de foto e falhar no envio.
ALTER TABLE cb_scheduled_messages
  DROP CONSTRAINT IF EXISTS cb_scheduled_messages_legenda_check;

ALTER TABLE cb_scheduled_messages
  ADD CONSTRAINT cb_scheduled_messages_legenda_check
  CHECK (media_url IS NULL OR length(body) <= 1024);

-- ------------------------------------------------------------
-- 4) Conferir o RESULTADO, não a intenção
-- ------------------------------------------------------------
-- Convenção do CLAUDE.md. Aqui vale mais que o normal: os CHECKs desta
-- migration são a única coisa entre um POST malformado e uma mensagem que sai
-- errada para cliente, de madrugada, sem ninguém na tela.
DO $$
DECLARE
  conversa uuid;
  canal uuid;
  conta uuid;
  novo uuid;
BEGIN
  -- As colunas existem?
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'cb_scheduled_messages'
       AND column_name IN ('media_url', 'media_path', 'media_kind',
                           'media_filename', 'reply_to_message_id',
                           'citacao_perdida')
  ) <> 6 THEN
    RAISE EXCEPTION '932: faltou coluna nova em cb_scheduled_messages.';
  END IF;

  -- Uma conversa real desta base para exercitar os CHECKs de verdade. Sem
  -- linha para usar, os testes abaixo são pulados — a migration continua
  -- válida numa base recém-criada.
  SELECT c.id, c.account_id, ch.id
    INTO conversa, conta, canal
    FROM conversations c
    JOIN cb_channels ch ON ch.account_id = c.account_id
   LIMIT 1;

  IF conversa IS NULL THEN
    RAISE NOTICE '932: sem conversa/canal para exercitar os CHECKs; pulando.';
    RETURN;
  END IF;

  -- (a) Mídia sem legenda tem de PASSAR — é o afrouxamento que a fase pediu.
  INSERT INTO cb_scheduled_messages
    (account_id, conversation_id, channel_id, body, scheduled_for,
     autor_nome, media_url, media_path, media_kind)
  VALUES
    (conta, conversa, canal, '', now() + interval '10 years',
     '932 conferência', 'https://exemplo/x.png', 'account-x/x.png', 'image')
  RETURNING id INTO novo;
  DELETE FROM cb_scheduled_messages WHERE id = novo;

  -- (b) Texto vazio SEM mídia continua barrado.
  BEGIN
    INSERT INTO cb_scheduled_messages
      (account_id, conversation_id, channel_id, body, scheduled_for, autor_nome)
    VALUES
      (conta, conversa, canal, '   ', now() + interval '10 years', '932');
    RAISE EXCEPTION '932: corpo vazio sem mídia foi aceito — o CHECK afrouxou demais.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (c) Áudio com legenda tem de ser BARRADO.
  BEGIN
    INSERT INTO cb_scheduled_messages
      (account_id, conversation_id, channel_id, body, scheduled_for,
       autor_nome, media_url, media_path, media_kind)
    VALUES
      (conta, conversa, canal, 'legenda que nunca chegaria',
       now() + interval '10 years', '932',
       'https://exemplo/v.ogg', 'account-x/v.ogg', 'audio');
    RAISE EXCEPTION '932: áudio com legenda foi aceito — o texto sumiria no envio.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (d) Meio anexo tem de ser BARRADO.
  BEGIN
    INSERT INTO cb_scheduled_messages
      (account_id, conversation_id, channel_id, body, scheduled_for,
       autor_nome, media_url)
    VALUES
      (conta, conversa, canal, 'oi', now() + interval '10 years', '932',
       'https://exemplo/x.png');
    RAISE EXCEPTION '932: anexo pela metade foi aceito.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (e) Tipo de mídia fora da lista tem de ser BARRADO.
  BEGIN
    INSERT INTO cb_scheduled_messages
      (account_id, conversation_id, channel_id, body, scheduled_for,
       autor_nome, media_url, media_path, media_kind)
    VALUES
      (conta, conversa, canal, '', now() + interval '10 years', '932',
       'https://exemplo/x.bin', 'account-x/x.bin', 'sticker');
    RAISE EXCEPTION '932: media_kind fora da lista foi aceito.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (f) Legenda acima de 1024 com mídia tem de ser BARRADA.
  BEGIN
    INSERT INTO cb_scheduled_messages
      (account_id, conversation_id, channel_id, body, scheduled_for,
       autor_nome, media_url, media_path, media_kind)
    VALUES
      (conta, conversa, canal, repeat('a', 1025), now() + interval '10 years',
       '932', 'https://exemplo/x.png', 'account-x/x.png', 'image');
    RAISE EXCEPTION '932: legenda acima de 1024 foi aceita.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (g) Texto puro de até 4000 continua passando — a 925 não pode ter
  -- regredido.
  INSERT INTO cb_scheduled_messages
    (account_id, conversation_id, channel_id, body, scheduled_for, autor_nome)
  VALUES
    (conta, conversa, canal, repeat('b', 4000), now() + interval '10 years', '932')
  RETURNING id INTO novo;
  DELETE FROM cb_scheduled_messages WHERE id = novo;
END $$;
