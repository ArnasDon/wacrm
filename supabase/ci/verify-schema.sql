-- Post-migration assertions for the `migrations` job in
-- `.github/workflows/pipeline.yml`. (O `migrations.yml` que este cabeçalho
-- citava era do upstream e foi removido no merge de 2026-08-26.)
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- ⚠️ Disparo e regras são de ADMIN (964) — e a checagem é pelo CONJUNTO.
  --
  -- A conferência DENTRO da 964 pega policy RENOMEADA (conta os 12 nomes
  -- esperados) e policy AFROUXADA (procura 'agent' nas 12). O que ela não
  -- pega é policy ADICIONADA — e em Postgres policies permissivas são
  -- combinadas com OU, então UMA a mais reabre o furo inteiro com as 12
  -- originais intactas e a migration imprimindo "OK".
  --
  -- O caso real: um merge do upstream reintroduzindo a
  -- "Users can manage own broadcasts" (001, `FOR ALL USING auth.uid() =
  -- user_id`). A 017 a derrubou; um merge futuro a traz de volta.
  --
  -- Aqui a pergunta é outra: existe ALGUMA policy de escrita nessas seis
  -- tabelas fora das 12? Se existir, o nome dela sai na mensagem.
  --
  -- ⚠️ O par (tabela, nome), não o nome sozinho: `broadcasts_insert` criada
  -- em `automations` — por `EXECUTE format(...)`, que o teste estrutural do
  -- vitest não enxerga — é uma policy de escrita A MAIS, e por nome ela
  -- passava (achado do Codex no PR #98).
  --
  -- E a segunda pergunta, que só faz sentido AQUI, no fim do replay: as 12
  -- ainda exigem admin? A conferência da 964 roda no instante da 964; uma
  -- migration posterior que derrube e recrie uma delas com `'agent'` passa
  -- por ela verde. É a mesma régua da 964, sobre o estado FINAL.
  DECLARE
    v_intrusas TEXT;
    v_frouxas TEXT;
  BEGIN
    SELECT string_agg(format('%s.%s', p.tablename, p.policyname), ', ' ORDER BY p.tablename, p.policyname)
    INTO v_intrusas
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN (
        'automations', 'automation_steps', 'flows',
        'flow_nodes', 'broadcasts', 'broadcast_recipients'
      )
      AND p.cmd <> 'SELECT'
      AND (p.tablename, p.policyname) NOT IN (
        ('automations', 'automations_insert'),
        ('automations', 'automations_update'),
        ('automations', 'automations_delete'),
        ('automation_steps', 'automation_steps_modify'),
        ('flows', 'flows_insert'),
        ('flows', 'flows_update'),
        ('flows', 'flows_delete'),
        ('flow_nodes', 'flow_nodes_modify'),
        ('broadcasts', 'broadcasts_insert'),
        ('broadcasts', 'broadcasts_update'),
        ('broadcasts', 'broadcasts_delete'),
        ('broadcast_recipients', 'broadcast_recipients_modify')
      );
    IF v_intrusas IS NOT NULL THEN
      RAISE EXCEPTION
        'policy de escrita inesperada em tabela de disparo/regras: % — policies permissivas se somam com OU, então esta reabre o acesso que a 964 fechou',
        v_intrusas;
    END IF;

    SELECT string_agg(format('%s.%s', p.tablename, p.policyname), ', ' ORDER BY p.tablename, p.policyname)
    INTO v_frouxas
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN (
        'automations', 'automation_steps', 'flows',
        'flow_nodes', 'broadcasts', 'broadcast_recipients'
      )
      AND p.cmd <> 'SELECT'
      AND (
        coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%''agent''%'
        OR coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%''admin''%'
      );
    IF v_frouxas IS NOT NULL THEN
      RAISE EXCEPTION
        'policy de escrita de disparo/regras que não exige admin no FIM do replay: % — a 964 conferiu só o instante dela; alguém a recriou frouxa depois',
        v_frouxas;
    END IF;
  END;

  -- ⚠️ A função de disparo (1030): no FIM do replay tem de sobrar UMA — a de
  -- NOVE parâmetros, com `p_template_params JSONB` e o RETURNING qualificado.
  -- O corpo de uma função plpgsql só é analisado quando a instrução RODA:
  -- 0040, 0041 e 0940 aplicaram limpas com um `RETURNING id, contact_id` que
  -- estoura 42702 na primeira chamada, e o replay passou verde nas três.
  --
  -- A asserção equivalente do upstream faz `::regprocedure` na assinatura de
  -- OITO parâmetros, que aqui não existe (a 0940 a apaga) — o cast estouraria
  -- com um erro cru. E a 041 deles, aplicada crua, ressuscita esse overload:
  -- uma chamada sem o canal cairia na função que não carimba
  -- `broadcasts.channel_id`. ⚠️ Este replay nunca CHAMA a função (o banco não
  -- tem conta para a FK) — quem a chama é a conferência da própria 1030, em
  -- todo banco que tenha dado.
  DECLARE
    v_quantas  integer;
    v_disparo  regprocedure;
    v_def      text;
  BEGIN
    SELECT count(*) INTO v_quantas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_broadcast_with_recipients';
    IF v_quantas <> 1 THEN
      RAISE EXCEPTION
        'create_broadcast_with_recipients tem % assinatura(s) no fim do replay (esperado 1) — a 041 do upstream entrou crua, ou a 1030 não aplicou?',
        v_quantas;
    END IF;
    -- `to_regprocedure` devolve NULL em vez de estourar; o NULL é tratado
    -- aqui, senão o LIKE abaixo daria NULL e o IF passaria calado.
    v_disparo := to_regprocedure(
      'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb,uuid)'
    );
    IF v_disparo IS NULL THEN
      RAISE EXCEPTION
        'a função de disparo que sobrou não é a de nove parâmetros com p_template_params JSONB (1030)';
    END IF;
    v_def := pg_get_functiondef(v_disparo);
    -- ⚠️ O LIKE é LITERAL: exige a grafia exata da 1030. Uma migration futura
    -- que reescreva a função de forma LEGÍTIMA com outra grafia (um alias na
    -- tabela, por exemplo) reprova aqui sem ter defeito nenhum — por isso a
    -- mensagem diz as duas causas, e o que fazer na segunda.
    IF v_def NOT LIKE '%RETURNING id, broadcast_recipients.contact_id%'
       OR v_def LIKE '%RETURNING id, contact_id%' THEN
      RAISE EXCEPTION
        'create_broadcast_with_recipients não tem o RETURNING na grafia da 1030 (`RETURNING id, broadcast_recipients.contact_id`). Ou ele voltou a ser ambíguo (a 1030 não aplicou, ou alguém recriou a função crua depois), ou uma migration nova a reescreveu de forma legítima com outra grafia — nesse caso atualize esta asserção e o pino supabase/migrations/funcao-de-disparo-1030.test.ts';
    END IF;
  END;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
