-- ============================================================
-- 921 — a exclusão de anotação também chega pelo realtime
--
-- A 918 pôs `cb_conversation_notes` na publication, mas com a REPLICA
-- IDENTITY padrão o payload de um DELETE traz **só a chave primária**. Sem as
-- outras colunas, o Postgres não consegue avaliar nem o filtro por conversa
-- nem a policy de RLS, e o evento simplesmente não é entregue a ninguém.
--
-- Isso ficou visível quando a seção "Notas" da ficha passou a usar o mesmo
-- hook do fio: as duas listas ficam na tela AO MESMO TEMPO, lado a lado.
-- Apagar a anotação no fio a removia dali e a deixava intacta na ficha, a
-- dois centímetros de distância, até recarregar a página. Some pela mesma
-- lógica quando quem apaga é um colega noutra máquina.
--
-- ⚠️ Contra o que a 918 escreveu. O comentário de lá dizia que trocar a
-- replica identity "custaria mais WAL em toda escrita" — o argumento está
-- errado para esta tabela, por dois motivos que valem conferir antes de
-- copiar a frase para outro lugar:
--
--   1. REPLICA IDENTITY não afeta INSERT. Ela decide o que vai no registro
--      de imagem ANTIGA, que só existe em UPDATE e DELETE. E o INSERT é
--      ~100% da escrita aqui.
--   2. Esta tabela não tem UPDATE nenhum: a 918 revogou o privilégio e não
--      criou policy. Sobra o DELETE, que é raro e de linha pequena (um
--      texto curto, sem mídia).
--
-- O custo real é próximo de zero. A frase da 918 foi importada de tabelas de
-- tráfego alto — `messages` — onde ela é verdadeira.
-- ============================================================

ALTER TABLE cb_conversation_notes REPLICA IDENTITY FULL;

-- Conferência: o resultado, não a intenção.
DO $$
DECLARE
  identidade "char";
  na_publication boolean;
BEGIN
  SELECT relreplident INTO identidade
    FROM pg_class WHERE oid = 'public.cb_conversation_notes'::regclass;
  IF identidade <> 'f' THEN
    RAISE EXCEPTION '921: replica identity ficou em % (esperado f = FULL)', identidade;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_conversation_notes'
  ) INTO na_publication;
  IF NOT na_publication THEN
    RAISE EXCEPTION '921: a tabela saiu da publication supabase_realtime';
  END IF;
END $$;
