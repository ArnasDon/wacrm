-- ============================================================
-- 929 — Busca no corpo das mensagens (F2, fatia B)
--
-- Até aqui a caixa de busca do inbox olhava quatro campos que a LISTA já tinha
-- na mão: nome, telefone, nome do grupo e o texto da ÚLTIMA mensagem. Achar uma
-- conversa pelo que foi dito nela só funcionava se aquilo tivesse sido a última
-- coisa dita — ou seja, quase nunca. Esta migration dá ao banco a capacidade de
-- responder "em quais conversas alguém escreveu isto", sobre o histórico
-- inteiro.
--
-- ⚠️ POR QUE UMA FUNÇÃO, E NÃO UMA CONSULTA DIRETA DO NAVEGADOR
-- Porque `select conversation_id from messages where content_text ilike …`
-- devolve UMA LINHA POR MENSAGEM, e o PostgREST corta a resposta em 1000 linhas
-- **sem avisar**. Um termo comum ("obrigado") passaria do teto e as conversas
-- além dele sumiriam do resultado — busca incompleta com cara de completa. É o
-- mesmo motivo que fez a 025 do upstream virar RPC. Aqui o `DISTINCT ON`
-- colapsa para uma linha por CONVERSA antes de sair do banco, e o teto deixa de
-- existir na prática (o limite passa a ser o número de conversas da conta).
--
-- ⚠️ TRIGRAMA, NÃO `tsvector` — e a razão é coerência, não desempenho.
-- A mesma caixa de texto já busca nome e telefone por PEDAÇO (`includes` em
-- JS). Com `tsvector` o corpo passaria a buscar por PALAVRA INTEIRA com
-- radicalização: digitar "advog" acharia o contato "Advogados" e não acharia a
-- mensagem que diz "advogado". Dois comportamentos diferentes no mesmo campo,
-- sem nada na tela explicando qual está valendo. Trigrama casa por pedaço, que
-- é o que o operador já espera daquela caixa.
--
-- ⚠️ SÓ O TEXTO VIGENTE (P2.7, decisão do operador). `deleted_at IS NULL` está
-- no índice E na consulta. As 12 mensagens apagadas continuam guardadas (7
-- ainda com texto) porque o escritório quis o registro — mas achar uma conversa
-- pelo que foi APAGADO nela é decisão jurídica, não efeito colateral de
-- índice. `text_before_edit` fica de fora pelo mesmo motivo.
-- ============================================================

-- ------------------------------------------------------------
-- Extensões
--
-- Vão para o schema `extensions`, onde `pgcrypto` e `uuid-ossp` já moram — é a
-- convenção do Supabase e mantém `public` limpo.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- A normalização, num lugar só
--
-- ⚠️ UMA função para as duas pontas, de propósito. O índice guarda o texto
-- transformado e a consulta transforma o termo digitado; se as duas pontas
-- usassem expressões diferentes — uma com `lower(unaccent(x))` e a outra com
-- `unaccent(lower(x))` — o índice simplesmente NÃO SERIA USADO, e ninguém
-- perceberia: o resultado sairia certo, só lento. Com uma função só, a
-- divergência deixa de ser possível.
--
-- ⚠️ `IMMUTABLE` é obrigatório e é uma pequena mentira consciente. O
-- `unaccent(text)` de um argumento é STABLE (consulta o dicionário padrão em
-- tempo de execução) e por isso NÃO PODE entrar em índice. A forma de dois
-- argumentos, com o dicionário fixado, é immutable de verdade — e é a receita
-- documentada. A consequência a saber: se alguém trocar o dicionário
-- `unaccent`, este índice precisa ser recriado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_texto_para_busca(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_texto));
$$;

COMMENT ON FUNCTION public.cb_texto_para_busca(text) IS
  'Forma canônica de comparar texto na busca do inbox: minúsculas e sem acento. Usada pelo índice E pela consulta — mudar uma sem a outra desliga o índice em silêncio.';

-- ------------------------------------------------------------
-- O índice
--
-- GIN de trigrama sobre o texto normalizado. Parcial nas duas condições que a
-- consulta sempre repete — mensagem apagada e mensagem sem texto não são
-- buscáveis, então não ocupam índice.
--
-- Hoje isto indexa 38 KB de texto e é irrelevante para o desempenho: com 963
-- mensagens o Postgres varre tudo em menos de um milissegundo. Existe porque a
-- base cresce ~150 mensagens/dia e o dia de precisar não avisa antes.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS messages_busca_trgm_idx
  ON public.messages
  USING gin (public.cb_texto_para_busca(content_text) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND content_text IS NOT NULL;

-- ------------------------------------------------------------
-- A busca
--
-- Devolve CONVERSAS, não mensagens (P2.1) — saltar para o trecho exige âncora e
-- rolagem no fio, que é outra feature. Junto vem o pedaço de texto que casou e
-- quantas mensagens casaram, porque sem isso a linha aparece na lista mostrando
-- a prévia de sempre (a ÚLTIMA mensagem), que não contém o termo — e o operador
-- lê aquilo como defeito.
--
-- ⚠️ `SECURITY INVOKER` (o padrão, escrito por extenso para não haver dúvida na
-- releitura). A RLS de `messages` atravessa `conversations`
-- (`is_account_member(c.account_id)`), então a função enxerga exatamente o que
-- quem chamou enxerga. A 032 do upstream foi correção de CVE por exatamente o
-- contrário: `SECURITY DEFINER` sem checagem de conta.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_buscar_conversas_por_texto(p_termo text)
RETURNS TABLE (conversation_id uuid, trecho text, quantas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH termo AS (
    SELECT
      public.cb_texto_para_busca(btrim(p_termo)) AS normalizado,
      -- ⚠️ Escapar é obrigatório, não zelo. Sem isto, digitar `%` na caixa de
      -- busca casa com TODAS as mensagens da conta e `_` casa com qualquer
      -- caractere — o operador veria a lista inteira "achada" e não teria como
      -- saber por quê.
      replace(replace(replace(
        public.cb_texto_para_busca(btrim(p_termo)),
        '\', '\\'), '%', '\%'), '_', '\_') AS padrao
  ),
  casadas AS (
    SELECT m.conversation_id, m.content_text, m.created_at
      FROM public.messages m, termo
     -- Menos de 3 caracteres não é busca: o trigrama não indexa e o resultado
     -- seria "quase tudo". A guarda mora AQUI, e não só na tela, para que
     -- qualquer outro chamador herde o mesmo piso.
     WHERE length(termo.normalizado) >= 3
       AND m.deleted_at IS NULL
       AND m.content_text IS NOT NULL
       AND public.cb_texto_para_busca(m.content_text)
           LIKE '%' || termo.padrao || '%'
  )
  SELECT DISTINCT ON (c.conversation_id)
         c.conversation_id,
         -- Uma janela ao redor do que casou, não os primeiros 240 caracteres:
         -- em mensagem longa o termo costuma estar no meio, e um pedaço que
         -- não mostra o termo não explica nada. 17 mensagens já passam de 240
         -- caracteres hoje.
         substr(
           c.content_text,
           greatest(
             1,
             strpos(
               public.cb_texto_para_busca(c.content_text),
               (SELECT normalizado FROM termo)
             ) - 40
           ),
           240
         ) AS trecho,
         count(*) OVER (PARTITION BY c.conversation_id) AS quantas
    FROM casadas c
   ORDER BY c.conversation_id, c.created_at DESC;
$$;

COMMENT ON FUNCTION public.cb_buscar_conversas_por_texto(text) IS
  'Quais conversas têm alguma mensagem contendo este texto. Uma linha por conversa (o PostgREST corta 1000 linhas sem avisar, e uma linha por mensagem estouraria isso). Ignora mensagem apagada.';

-- ------------------------------------------------------------
-- Privilégios
--
-- ⚠️ O par completo, sempre. A forma da concessão varia por função conforme o
-- `ALTER DEFAULT PRIVILEGES` vigente quando ela nasceu: revogar só de PUBLIC
-- não tira nada quando a concessão é por papel, e revogar só dos papéis não
-- tira nada quando a concessão é do PUBLIC. Este projeto já errou isso TRÊS
-- vezes (903 e 912 revogaram só dos papéis; 914 revogou só de PUBLIC) e as três
-- passaram em revisão de código. O bloco de conferência no fim é o que pegou.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cb_texto_para_busca(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cb_buscar_conversas_por_texto(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cb_buscar_conversas_por_texto(text) TO authenticated;

-- ⚠️ A de normalizar TAMBÉM precisa ser concedida, e o motivo não é óbvio:
-- `SECURITY INVOKER` checa privilégio de tudo que roda DENTRO da função, como o
-- usuário que chamou. Deixando `cb_texto_para_busca` fechada, a busca inteira
-- estouraria `permission denied` para todo mundo logado — e o bloco de
-- conferência abaixo, que roda como dono, NÃO pegaria isso. Por isso ele troca
-- de papel antes de testar. Conceder é inócuo: a função só transforma texto,
-- não lê linha nenhuma.
GRANT EXECUTE ON FUNCTION public.cb_texto_para_busca(text) TO authenticated;

-- ------------------------------------------------------------
-- Conferir o RESULTADO, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_achou int;
  v_termo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'unaccent'
  ) THEN
    RAISE EXCEPTION '929: alguma das duas extensões não ficou instalada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'messages_busca_trgm_idx'
  ) THEN
    RAISE EXCEPTION '929: o índice de trigrama não foi criado.';
  END IF;

  -- A normalização faz as DUAS coisas. Se um dia alguém tirar o `lower` ou o
  -- `unaccent`, a busca passa a errar em silêncio (o índice continua lá).
  IF public.cb_texto_para_busca('ÁÇÃO Judicial') <> 'acao judicial' THEN
    RAISE EXCEPTION '929: a normalização não tira acento e/ou não baixa a caixa: %',
      public.cb_texto_para_busca('ÁÇÃO Judicial');
  END IF;

  -- ⚠️ `anon` não pode buscar mensagem de ninguém. A RLS já barraria, mas
  -- deixar a função aberta transformaria um bug de RLS futuro em vazamento.
  IF has_function_privilege('anon', 'public.cb_buscar_conversas_por_texto(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '929: anon pode executar a busca.';
  END IF;

  IF has_function_privilege('anon', 'public.cb_texto_para_busca(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '929: anon pode normalizar texto.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.cb_buscar_conversas_por_texto(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '929: authenticated perdeu a busca — a tela depende dela.';
  END IF;

  -- Prova de vida: procurar as primeiras letras de alguma mensagem real tem de
  -- devolver pelo menos aquela conversa. Roda como dono (ignora RLS), o que
  -- aqui é o que se quer: a pergunta é sobre a MECÂNICA, não sobre escopo.
  --
  -- ⚠️ Só faz sentido se HOUVER mensagem. Num banco recém-criado — o do CI, que
  -- reaplica tudo do zero — a subconsulta devolve NULL, a busca não acha nada e
  -- a conferência reprovava por não encontrar uma linha que nunca existiu. O
  -- termo vai para uma variável justamente para poder distinguir "a busca está
  -- quebrada" de "não há o que buscar".
  SELECT substr(content_text, 1, 6) INTO v_termo
    FROM public.messages
   WHERE deleted_at IS NULL AND length(content_text) >= 6
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_termo IS NULL THEN
    RAISE NOTICE '929: sem mensagem para a prova de vida — banco vazio, nada a provar.';
  ELSE
    SELECT count(*) INTO v_achou
      FROM public.cb_buscar_conversas_por_texto(v_termo);
    IF v_achou < 1 THEN
      RAISE EXCEPTION '929: a busca não achou nem a mensagem de onde o termo saiu (termo=%).', v_termo;
    END IF;
  END IF;

  -- Termo curto não pode devolver nada, senão o piso de 3 caracteres é decoração.
  IF EXISTS (SELECT 1 FROM public.cb_buscar_conversas_por_texto('a')) THEN
    RAISE EXCEPTION '929: termo de 1 caractere devolveu resultado.';
  END IF;

  -- Curinga digitado é texto literal, não curinga.
  IF EXISTS (SELECT 1 FROM public.cb_buscar_conversas_por_texto('%%%')) THEN
    RAISE EXCEPTION '929: o %% da caixa de busca está funcionando como curinga.';
  END IF;
END $$;

-- ⚠️ O SELECT em `messages` tem de ser ESCRITO, não herdado (mesma causa da
-- 919). A busca é `SECURITY INVOKER`: o Postgres checa, DENTRO dela, o
-- privilégio de quem chamou. Em produção o `authenticated` tem esse SELECT
-- pelo *default privilege* do Supabase, que nunca foi escrito por migration
-- nenhuma — num banco novo ele não existe, e a conferência abaixo reprovava
-- com "permission denied for table messages".
--
-- Concedido o que a produção já tem; lá é no-op.
GRANT SELECT ON TABLE public.messages, public.conversations TO authenticated;
--
-- `conversations` entra junto porque a POLÍTICA de `messages` a consulta:
--   messages_select → EXISTS (SELECT 1 FROM conversations c WHERE ...)
-- e RLS é avaliada com o privilégio de quem chamou. A cadeia para aí:
-- `is_account_member`, que a política usa em seguida, é SECURITY DEFINER —
-- roda como dono e não exige mais nada do chamador.

-- ⚠️ A conferência que só existe trocando de papel.
--
-- Tudo acima roda como dono e enxerga tudo. O modo de falha real desta
-- migration é OUTRO: `SECURITY INVOKER` faz o Postgres checar, dentro da
-- função, o privilégio de quem chamou — e uma função auxiliar fechada derruba a
-- busca inteira para todo usuário logado, com a migration passando verde. Este
-- bloco chama a busca COMO `authenticated` para que esse caso apareça agora, e
-- não na tela do operador. O resultado é vazio (sem sessão, `auth.uid()` é nulo
-- e a RLS não devolve nada) e isso está certo: o que se testa aqui é
-- privilégio, não escopo.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.cb_buscar_conversas_por_texto('contrato');
  RESET ROLE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION '929: authenticated não consegue executar a busca: %', SQLERRM;
END $$;
