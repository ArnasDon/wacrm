-- ============================================================
-- 930 — Reticência no trecho da busca (F2 fatia B, achado da verificação)
--
-- A 929 recorta uma janela de 240 caracteres ao redor do termo, começando 40
-- antes dele. Numa mensagem longa esse corte cai NO MEIO DE UMA PALAVRA, e a
-- linha da lista mostrava:
--
--     az só um ajuste no .env.local e cria um docker-compose pra fazer a conexão
--
-- "az" é o fim de "Faz". Sem nada indicando que aquilo é um pedaço, o operador
-- lê texto truncado como texto corrompido — e num CRM jurídico "a mensagem do
-- cliente aparece cortada" é exatamente o tipo de dúvida que ninguém quer ter.
--
-- A reticência não deixa o corte bonito; deixa o corte HONESTO, que é o que
-- importa. Só aparece do lado que foi realmente cortado.
--
-- ⚠️ Só troca o corpo da função. Índice, privilégios e assinatura seguem os da
-- 929 — `CREATE OR REPLACE` preserva as concessões.
-- ============================================================

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
  ),
  janela AS (
    -- Onde a janela começa. Calculado uma vez porque as duas reticências e o
    -- `substr` dependem do mesmo número.
    SELECT
      c.conversation_id,
      c.content_text,
      c.created_at,
      greatest(
        1,
        strpos(
          public.cb_texto_para_busca(c.content_text),
          (SELECT normalizado FROM termo)
        ) - 40
      ) AS inicio
    FROM casadas c
  )
  SELECT DISTINCT ON (j.conversation_id)
         j.conversation_id,
         CASE WHEN j.inicio > 1 THEN '…' ELSE '' END
           || substr(j.content_text, j.inicio, 240)
           || CASE WHEN length(j.content_text) > j.inicio + 239 THEN '…' ELSE '' END
           AS trecho,
         count(*) OVER (PARTITION BY j.conversation_id) AS quantas
    FROM janela j
   ORDER BY j.conversation_id, j.created_at DESC;
$$;

-- ------------------------------------------------------------
-- Conferir o RESULTADO, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_trecho text;
  v_curto  text;
  v_termo  text;
BEGIN
  -- Mensagem longa com o termo lá pelo meio: tem de vir com reticência na
  -- frente. A busca roda como dono aqui (ignora RLS) — a pergunta é sobre o
  -- recorte, não sobre escopo.
  --
  -- ⚠️ O termo sai do DADO, não é literal. Antes era 'docker', que só achava
  -- alguma coisa porque ESTE banco tem uma mensagem com essa palavra. Num banco
  -- recém-criado — o do CI, que reaplica tudo do zero — não achava nada, e a
  -- conferência reprovava por falta de dado, não por defeito no recorte.
  --
  -- Posição 60 numa mensagem de 120+: a janela começa em `strpos - 40`, então o
  -- termo precisa estar além do caractere 41 para que `inicio > 1` e a
  -- reticência da esquerda apareça. 60 dá margem folgada.
  SELECT substr(m.content_text, 60, 8) INTO v_termo
    FROM public.messages m
   WHERE m.deleted_at IS NULL
     AND length(m.content_text) >= 120
     -- Termo com '%' ou quase todo em branco não serve de prova: o primeiro
     -- testaria curinga (assunto da 929), o segundo não casa nada.
     AND substr(m.content_text, 60, 8) NOT LIKE '%\%%'
     AND length(btrim(substr(m.content_text, 60, 8))) >= 4
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF v_termo IS NULL THEN
    RAISE NOTICE '930: sem mensagem longa para provar o recorte — banco vazio, nada a provar.';
  ELSE
    SELECT t.trecho INTO v_trecho
      FROM public.cb_buscar_conversas_por_texto(v_termo) t
     LIMIT 1;

    IF v_trecho IS NULL THEN
      RAISE EXCEPTION '930: o termo de prova (%) não achou nada — o teste não vale.', v_termo;
    END IF;

    IF left(v_trecho, 1) <> '…' THEN
      RAISE EXCEPTION '930: trecho cortado no início veio sem reticência: %', left(v_trecho, 30);
    END IF;
  END IF;

  -- E o contrário: termo no COMEÇO de uma mensagem curta não pode ganhar
  -- reticência nenhuma, senão a marca deixa de significar "está cortado".
  SELECT t.trecho INTO v_curto
    FROM public.cb_buscar_conversas_por_texto(
           (SELECT substr(content_text, 1, 8) FROM public.messages
             WHERE deleted_at IS NULL AND length(content_text) BETWEEN 8 AND 100
             ORDER BY created_at DESC LIMIT 1)
         ) t
   LIMIT 1;

  IF v_curto IS NOT NULL AND (left(v_curto, 1) = '…' OR right(v_curto, 1) = '…') THEN
    RAISE EXCEPTION '930: mensagem curta inteira veio marcada como cortada: %', v_curto;
  END IF;
END $$;
