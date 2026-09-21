-- ============================================================
-- 1030 — `create_broadcast_with_recipients` passa a poder ser EXECUTADA, e a
-- gravar os parâmetros de cada destinatário do jeito que o app os lê.
--
-- São DOIS defeitos na mesma função. O primeiro o upstream consertou (#536); o
-- segundo não — foi achado na revisão desta fase e medido em 21/09/2026.
--
-- 1. O `RETURNING` ambíguo (a função nunca executou)
--
--   A função é `RETURNS TABLE(broadcast_id, recipient_id, contact_id)`, e em
--   PL/pgSQL coluna de saída de RETURNS TABLE é TAMBÉM variável em escopo. O
--   INSERT dos destinatários terminava num `RETURNING id, contact_id` cru: esse
--   `contact_id` casa com a coluna da tabela E com a variável de saída, e o
--   Postgres recusa escolher — SQLSTATE 42702 na PRIMEIRA execução.
--
--   ⚠️ Nada acusava: o corpo de uma função plpgsql só é analisado quando a
--   instrução RODA. 0040, 0041 e 0940 aplicaram limpas, o replay do CI passou
--   nas três, e a função continuou incapaz de executar. Medido pela rota de
--   verdade, contra este banco: `POST /api/v1/broadcasts` → 500, com
--   `42702 column reference "contact_id" is ambiguous` no log. `broadcasts`
--   tinha ZERO linhas. (O único chamador é `createBroadcast`, em
--   `broadcast-core.ts`, alcançado só por essa rota — a tela de Disparos grava
--   a campanha direto na tabela, e o "retomar" não chama a função.)
--
-- 2. Os parâmetros por destinatário chegavam em DUAS DIMENSÕES
--
--   `p_template_params` era `JSONB[]`, e o app manda `string[][]` (uma lista
--   de parâmetros por destinatário). O PostgREST monta os argumentos nomeados
--   com `json_to_recordset(...) AS _("p_template_params" jsonb[], …)`, e nessa
--   conversão um array JSON de arrays vira um `jsonb[]` de DUAS dimensões —
--   não um array de listas. Medido num Postgres 16:
--     · 2 destinatários × 2 params → o `unnest` de dois arrays devolve QUATRO
--       linhas: o 2º contato recebe o 2º parâmetro do PRIMEIRO, e duas linhas
--       saem sem contato (23502) — a campanha inteira falha;
--     · 1 param por destinatário → grava `"Ana"` (texto) em vez de `["Ana"]`, e
--       o "retomar" (`Array.isArray`) reenviaria o modelo SEM as variáveis;
--     · contagens diferentes entre destinatários → `malformed JSON array` já
--       na conversão dos argumentos.
--   Só não mordeu porque os modelos desta conta têm zero variáveis.
--
--   O argumento passa a ser `JSONB` (o array de listas, inteiro), pareado com
--   os contatos por ORDINALIDADE. O corpo que o app manda não muda — o
--   PostgREST converte o mesmo JSON para o tipo novo.
--
-- Por que NÃO é a 041 do upstream
--
--   A 041 deles recria a assinatura de OITO parâmetros, que a nossa 0940
--   APAGOU de propósito ao criar a de NOVE (`p_channel_id`): com as duas de pé,
--   uma chamada sem o canal cairia em silêncio na que não carimba
--   `broadcasts.channel_id`. E ela não conserta o defeito 2.
--
-- Por que arquivo novo, e não editar a 0940
--
--   Migration aplicada está registrada no histórico: editar a 0940 consertaria
--   só instalação nova, e todo banco existente ficaria com a função quebrada.
--
-- Idempotente. A ordem dos argumentos e as colunas de saída não mudam, e o
-- app chama por NOME — `broadcast-core.ts` não precisa de edição.
-- ============================================================

-- As duas formas antigas saem: a de oito (se alguém a trouxe de volta) e a de
-- nove com `JSONB[]`. Mudar o TIPO de um argumento cria outra assinatura —
-- `CREATE OR REPLACE` sozinho deixaria a quebrada de pé ao lado da nova.
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB,
  p_channel_id        UUID
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients, channel_id
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, p_channel_id
  )
  RETURNING id INTO v_broadcast_id;

  -- Cada contato é pareado com a SUA lista de parâmetros pela posição
  -- (ORDINALITY dos dois lados). Lista mais curta que a de contatos, NULL ou
  -- algo que não é array → `template_params` NULL, que o "retomar" lê como
  -- "sem parâmetros". Lista mais LONGA não cria destinatário: quem manda é
  -- `p_contact_ids` (LEFT JOIN a partir dos contatos).
  --
  -- ⚠️ `broadcast_recipients.contact_id`, QUALIFICADO: `contact_id` sozinho
  -- casa também com a variável de saída do RETURNS TABLE (42702). Os outros
  -- nomes do corpo já são inequívocos: `broadcast_id` só aparece numa lista de
  -- colunas de INSERT, e o SELECT final lê através de `ins`.
  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, c.cid, 'pending', p.prm
    FROM unnest(p_contact_ids) WITH ORDINALITY AS c(cid, ord)
    LEFT JOIN jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_template_params) = 'array'
           THEN p_template_params ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS p(prm, ord) USING (ord)
    RETURNING id, broadcast_recipients.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

-- Mesma trava da 0940: só o service_role executa. SECURITY DEFINER aberto ao
-- `authenticated` deixaria qualquer sessão criar campanha em qualquer conta.
-- As duas metades do REVOKE (PUBLIC e os papéis) e o GRANT de volta — em banco
-- novo o EXECUTE nasce em PUBLIC, e o service_role o perderia junto.
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB, UUID) TO service_role;

-- O PostgREST converte o corpo do pedido usando o TIPO dos argumentos que tem
-- em cache. O Supabase recarrega o cache sozinho a cada DDL; o aviso explícito
-- é para não depender disso justamente quando o tipo de um argumento mudou.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferência. Confere o RESULTADO, não a intenção.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_quantas  INTEGER;
  v_oid      regprocedure;
  v_def      TEXT;
  v_conta    UUID;
  v_dono     UUID;
  v_contato  UUID;
  v_destinatario UUID;
  v_gravado  JSONB;
BEGIN
  -- 1. Sobrou UMA função com esse nome.
  SELECT count(*) INTO v_quantas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_broadcast_with_recipients';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1030: % assinatura(s) de create_broadcast_with_recipients (esperado 1)', v_quantas;
  END IF;

  -- 2. E é a de nove, com `p_template_params JSONB`. `to_regprocedure` devolve
  --    NULL em vez de estourar — o NULL é tratado aqui, senão o LIKE abaixo
  --    daria NULL e o IF passaria calado.
  v_oid := to_regprocedure(
    'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb,uuid)'
  );
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '1030: a função que sobrou não é a de nove parâmetros com p_template_params JSONB';
  END IF;
  v_def := pg_get_functiondef(v_oid);

  -- 3. O RETURNING qualificado está lá, e o cru NÃO (o positivo sozinho daria
  --    falso verde com a forma certa citada num comentário).
  IF v_def NOT LIKE '%RETURNING id, broadcast_recipients.contact_id%'
     OR v_def LIKE '%RETURNING id, contact_id%' THEN
    RAISE EXCEPTION '1030: a função continua com o RETURNING ambíguo';
  END IF;

  -- 4. Privilégios: as duas metades.
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1030: anon/authenticated conseguem executar a função';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1030: o service_role perdeu o EXECUTE';
  END IF;

  -- 5. ⚠️ A prova que faltou à 0040, à 0041 e à 0940: CHAMAR a função — e pelo
  --    mesmo caminho do PostgREST (`json_to_recordset` com o tipo do
  --    argumento), que é onde o defeito 2 morava. Tudo acontece num subbloco
  --    que se desfaz por exceção própria: nada sobra em `broadcasts` nem em
  --    `broadcast_recipients`. Banco vazio não tem conta para a FK — pula e
  --    avisa; conta sem contato nenhum chama com as listas vazias (prova o
  --    defeito 1, não o 2).
  SELECT id, owner_user_id INTO v_conta, v_dono FROM accounts LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1030: banco vazio — a função foi conferida pela definição, não chamada.';
    RETURN;
  END IF;
  SELECT id INTO v_contato FROM contacts WHERE account_id = v_conta LIMIT 1;

  BEGIN
    IF v_contato IS NULL THEN
      PERFORM * FROM public.create_broadcast_with_recipients(
        v_conta, v_dono, '1030 — conferência (desfeita)', 'conferencia', 'pt_BR',
        0, ARRAY[]::UUID[], '[]'::JSONB, NULL
      );
    ELSE
      -- ⚠️ DUAS instruções, e não um JOIN: dentro da MESMA instrução a consulta
      -- de fora não enxerga a linha que a função acabou de inserir (a foto da
      -- instrução é anterior ao INSERT). Medido: com o JOIN, o gravado vinha NULL
      -- e a conferência acusava a função certa.
      SELECT f.recipient_id INTO v_destinatario
      FROM json_to_recordset(
             json_build_array(json_build_object('c', json_build_array(v_contato),
                                                'p', '[["a","b"]]'::json))
           ) AS _(c UUID[], p JSONB),
           LATERAL public.create_broadcast_with_recipients(
             v_conta, v_dono, '1030 — conferência (desfeita)', 'conferencia', 'pt_BR',
             1, _.c, _.p, NULL
           ) f;
      SELECT r.template_params INTO v_gravado
      FROM broadcast_recipients r WHERE r.id = v_destinatario;
      IF v_gravado IS DISTINCT FROM '["a","b"]'::JSONB THEN
        RAISE EXCEPTION '1030: os parâmetros do destinatário foram gravados como %, e não como ["a","b"]', v_gravado;
      END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1030', MESSAGE = 'desfaz a chamada de conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1030' THEN
      RAISE NOTICE '1030: a função EXECUTOU% (e a chamada foi desfeita).',
        CASE WHEN v_contato IS NULL THEN ' com as listas vazias'
             ELSE ' e gravou a lista de parâmetros como lista' END;
  END;
END $$;
