-- ============================================================
-- 986 — o anexo grande do cliente para de se perder
--
-- MEDIDO em 2026-09-09, a partir de uma queixa da tela: dois PDFs que uma
-- cliente mandou apareceram como "Documento indisponível" no fio. Não foi a
-- Evolution nem o WhatsApp — foi o teto de 16 MiB do bucket `chat-media`
-- (023), espelhado no código. Os arquivos tinham 16,39 e 16,97 MiB.
--
-- A varredura da conta achou SETE anexos perdidos assim desde 01/09, todos
-- documentos de cliente, o maior com 46,07 MiB: extrato bancário, contrato,
-- regulamento — exatamente o material que motiva a conversa.
--
-- ⚠️ POR QUE 50 MiB, E NÃO MAIS
-- O teto GLOBAL de upload de um projeto Supabase começa em 50 MiB no plano
-- gratuito, e o limite do bucket não pode passar dele: pedir 64 MiB aqui
-- valeria neste projeto e explodiria na próxima instalação, no primeiro
-- anexo grande, sem nada na tela explicando. 50 MiB é o maior número que
-- vale em qualquer plano — e cobre com folga os 46 MiB do pior caso real.
--
-- O segundo motivo é memória: o download da Evolution vem em BASE64, então
-- um anexo de 50 MiB ocupa ~67 MB de string mais o buffer no processo Node
-- da VPS. Com o teto de 100 MB do WhatsApp isso dobraria, e o pico chega
-- junto com todo o resto que o webhook faz.
--
-- ⚠️ O código tem de espelhar este número (`MEDIA_MAX_BYTES_ENTRADA`, em
-- `src/lib/storage/upload-media.ts`), como `MIMES_POR_TIPO` espelha a
-- `allowed_mime_types`. Subir só aqui não faz o CRM aceitar nada — quem
-- recusa primeiro é o código; subir só lá faz o Storage recusar no fim,
-- com "erro de upload" e o arquivo já baixado.
--
-- Só o TETO muda. A lista de mimes e as policies da 023/954 ficam como
-- estão. Idempotente.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 52428800 -- 50 MiB
WHERE id = 'chat-media';

-- ============================================================
-- Conferência
-- ============================================================
DO $$
DECLARE
  v_limite bigint;
BEGIN
  SELECT file_size_limit INTO v_limite FROM storage.buckets WHERE id = 'chat-media';

  IF v_limite IS NULL THEN
    -- Banco sem o bucket: a 023 é quem o cria, e ela roda antes. Se um dia
    -- não rodar, dizer isso é melhor que reprovar por um bucket ausente.
    RAISE NOTICE '986: bucket chat-media não existe; nada a ajustar.';
  ELSIF v_limite <> 52428800 THEN
    RAISE EXCEPTION '986: chat-media ficou com file_size_limit = % (esperado 52428800)', v_limite;
  END IF;
END $$;
