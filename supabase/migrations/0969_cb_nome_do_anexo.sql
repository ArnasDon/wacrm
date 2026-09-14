-- ============================================================
-- 969 — Nome do arquivo do anexo
--
-- Até aqui o nome do documento não tinha onde morar: `messages` guardava
-- `media_url` e `media_type`, e nada mais. A bolha caía no rótulo genérico
-- "Documento" para 166 dos 188 documentos em produção (medido 2026-09-01) —
-- o operador não conseguia distinguir "ABRIL 2024.pdf" de "MARÇO 2024.pdf"
-- sem abrir os dois.
--
-- ⚠️ O nome SEMPRE chegou. O caminho da Meta o gravava em `content_text`
-- (`caption || filename`, webhook/route.ts), mas o da Evolution — que é o
-- que produção usa — lia só o `caption` e descartava o `fileName` que a
-- própria `getBase64FromMediaMessage` devolve. Ele sobrevivia apenas dentro
-- do caminho do objeto no Storage, degradado por `buildMediaPath` (espaço e
-- acento viram `_`, corte em 40 chars).
--
-- ⚠️ Coluna PRÓPRIA, e não mais `content_text`, de propósito: legenda e nome
-- de arquivo são coisas diferentes e um documento pode ter as duas. Empilhar
-- as duas na mesma coluna é o que faz o caminho da Meta PERDER o nome sempre
-- que o cliente escreve uma legenda. Além disso `content_text` alimenta a
-- busca (929) e o transcrito do Radar (941) — nome de arquivo ali passaria a
-- ser lido como fala do cliente.
--
-- ⚠️ SEM BACKFILL, de propósito. `mediaFilename` (src/lib/media/filename.ts)
-- já reconstrói o nome dos documentos antigos a partir do caminho do Storage,
-- e é a 2ª fonte da cascata dela. Gravar aqui a versão degradada
-- (`MAR_O_2024.pdf`) congelaria a perda no banco e apagaria a distinção entre
-- "nome verdadeiro, dito pelo remetente" e "nome reconstruído".
--
-- Nenhum GRANT novo: a coluna entra no SELECT que a tabela já concede e em
-- nada mais. Precedentes da mesma forma: `cb_scheduled_messages.media_filename`
-- (932) e `cb_media_library.filename` (953).
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_filename text;

COMMENT ON COLUMN messages.media_filename IS
  'Nome do arquivo como o remetente o enviou (documentMessage.fileName na Evolution, document.filename na Meta, o nome do upload no envio). NULL em mensagem sem anexo e nas linhas anteriores à 969 — nesses casos o nome é reconstruído do caminho do Storage por mediaFilename() (src/lib/media/filename.ts).';

-- Conferência de FORMA apenas — segura em banco vazio (nenhum dado exigido).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'media_filename'
  ) THEN
    RAISE EXCEPTION '969: coluna messages.media_filename não foi criada';
  END IF;
END $$;
