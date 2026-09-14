-- ============================================================
-- 967 — Filtros salvos da caixa de entrada (Fase A1)
--
-- Um recorte do inbox com NOME, para o operador acionar sob demanda em vez de
-- remontar os seis campos toda manhã ("Bancário + Reunião marcada").
--
-- ⚠️ POR QUE DA CONTA, E NÃO DE CADA MEMBRO
-- Decisão do operador (2026-08-31): os recortes que ele descreveu são do
-- ESCRITÓRIO — "SDR", "Jurídico", "Bancário" —, não gosto pessoal. Por isso
-- `admin`+ cria/edita/apaga e qualquer membro aplica, o mesmo regime das
-- automações e fluxos depois da 964. É o OPOSTO da `cb_conversation_favorites`
-- (924), que é por membro justamente porque marcar conversa é gosto pessoal.
--
-- ⚠️ O FILTRO PADRÃO NÃO MORA AQUI. Ele é escolha de CADA UM sobre um filtro
-- compartilhado, e vive na 968 (`cb_inbox_filtro_padrao`). Uma coluna `padrao`
-- nesta tabela seria uma marca compartilhada: o padrão de um apagaria o do
-- outro, em silêncio — exatamente o raciocínio que fez a 924 virar tabela em
-- vez de coluna em `conversations`.
--
-- ⚠️ O CONTEÚDO DO FILTRO É JSONB, DE PROPÓSITO. `FiltrosDoInbox`
-- (src/lib/inbox/filtros.ts) é o dono da forma e vai ganhar campos; uma coluna
-- por recorte obrigaria uma migration a cada filtro novo, e o banco NÃO
-- interpreta nada disto — ele guarda e devolve. Quem interpreta é
-- `lerFiltroSalvo`, que faz PARSE defensivo (parte de FILTROS_VAZIOS e só
-- aceita chave conhecida com o tipo certo), porque uma linha gravada antes de
-- um campo novo existir tem de continuar aplicável.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_inbox_saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- 60 é o que cabe no menu de 320px sem truncar no meio de uma palavra.
  nome text NOT NULL CHECK (btrim(nome) <> '' AND length(nome) <= 60),

  -- O `FiltrosDoInbox` serializado. `jsonb_typeof` barra o array/string/número
  -- solto que um cliente enganado mandaria: o parser do app trataria como
  -- objeto vazio e o filtro viraria "mostra tudo" com nome de recorte.
  filtros jsonb NOT NULL CHECK (jsonb_typeof(filtros) = 'object'),

  -- ⚠️ SET NULL, e NÃO o CASCADE da 924. Favorito é marcador pessoal e não quer
  -- dizer nada depois que a pessoa sai; o filtro "Jurídico" é recorte DO
  -- ESCRITÓRIO e tem de sobreviver a quem o criou — mesma lógica da anotação
  -- (918). Com CASCADE, alguém saindo da equipe levaria junto os recortes que
  -- o time inteiro usa todo dia.
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Escrito por quem edita (o hook manda `updated_at: now()` no UPDATE). Sem
  -- trigger de propósito: um trigger só para carimbar data numa tabela de meia
  -- dúzia de linhas é peça a mais para manter, e nada aqui depende do carimbo
  -- ser inviolável.
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cb_inbox_saved_filters IS
  'Recorte nomeado da caixa de entrada, DA CONTA: admin+ cria e edita, qualquer membro aplica. O conteúdo é o FiltrosDoInbox serializado (src/lib/inbox/filtros.ts) — o banco guarda e devolve, quem interpreta é lerFiltroSalvo.';

COMMENT ON COLUMN cb_inbox_saved_filters.filtros IS
  'FiltrosDoInbox serializado. Chave desconhecida é ignorada na leitura e campo ausente cai no padrão de FILTROS_VAZIOS — é o que deixa um filtro gravado hoje continuar aplicável depois de a forma ganhar campos.';

-- ⚠️ Único por NOME aparado e em minúsculas: dois "SDR" no menu não se
-- distinguem, e o operador aplicaria o errado sem nunca saber que havia dois.
-- `lower` e `btrim` são IMMUTABLE, então servem de índice de expressão.
--
-- Ele também é o índice do `account_id` (prefixo da expressão) — serve à
-- consulta da tela ("os filtros desta conta") e ao CASCADE de apagar a conta.
CREATE UNIQUE INDEX IF NOT EXISTS cb_inbox_saved_filters_nome_idx
  ON cb_inbox_saved_filters (account_id, lower(btrim(nome)));

-- Sem índice em `criado_por`: o SET NULL de apagar um usuário varre a tabela,
-- que tem uma linha por recorte do escritório (meia dúzia). Um índice aqui
-- custaria mais escrita do que economiza numa operação que acontece quando
-- alguém deixa a equipe.

-- ------------------------------------------------------------
-- 2) RLS — todo mundo lê, só admin escreve
-- ------------------------------------------------------------
ALTER TABLE cb_inbox_saved_filters ENABLE ROW LEVEL SECURITY;

-- Ler é de qualquer membro: o filtro é o recorte que a equipe usa, e um
-- `viewer` que não enxergasse o menu não conseguiria olhar a fila do próprio
-- time.
DROP POLICY IF EXISTS cb_inbox_saved_filters_select ON cb_inbox_saved_filters;
CREATE POLICY cb_inbox_saved_filters_select ON cb_inbox_saved_filters FOR SELECT
  USING (is_account_member(account_id));

-- Escrever é `admin`+, a mesma régua que a 964 deu a automações, fluxos e
-- disparos. Aqui o motivo é outro e menor: um filtro é um atalho, não um
-- disparo. Mas ele é COMPARTILHADO — renomear "Jurídico" muda a tela de todo
-- mundo, e apagar tira o atalho de quem o tinha como padrão.
DROP POLICY IF EXISTS cb_inbox_saved_filters_insert ON cb_inbox_saved_filters;
CREATE POLICY cb_inbox_saved_filters_insert ON cb_inbox_saved_filters FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ⚠️ USING **e** WITH CHECK. Só o USING deixaria um admin mover a linha para
-- outra conta no mesmo UPDATE (a FK aceitaria, se ele fosse admin lá também);
-- só o WITH CHECK deixaria editar linha que ele não pode ver.
DROP POLICY IF EXISTS cb_inbox_saved_filters_update ON cb_inbox_saved_filters;
CREATE POLICY cb_inbox_saved_filters_update ON cb_inbox_saved_filters FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS cb_inbox_saved_filters_delete ON cb_inbox_saved_filters;
CREATE POLICY cb_inbox_saved_filters_delete ON cb_inbox_saved_filters FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ⚠️ As duas metades, sempre (convenção do CLAUDE.md, escrita depois de três
-- enganos seguidos): o REVOKE tira do `anon`, e o GRANT devolve por ESCRITO ao
-- `authenticated`. O privilégio que o Supabase concede sozinho por
-- `ALTER DEFAULT PRIVILEGES` é do AMBIENTE e não existe em banco novo — sem o
-- GRANT, o CI que replaya as migrations do zero reprova.
REVOKE ALL ON TABLE cb_inbox_saved_filters FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cb_inbox_saved_filters TO authenticated;

-- ------------------------------------------------------------
-- 3) Conferir o RESULTADO, não a intenção
--
-- ⚠️ Nenhuma conferência aqui exige DADO. Afirmar ausência é verdade trivial em
-- banco vazio; afirmar presença é o que reprovou nove migrations nossas na
-- primeira vez que o CI as reaplicou do zero.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_policies int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_inbox_saved_filters'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '967: RLS não ficou ligada em cb_inbox_saved_filters.';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cb_inbox_saved_filters';
  IF v_policies <> 4 THEN
    RAISE EXCEPTION '967: esperava 4 policies (select/insert/update/delete), achei %.', v_policies;
  END IF;

  IF has_table_privilege('anon', 'public.cb_inbox_saved_filters', 'SELECT') THEN
    RAISE EXCEPTION '967: anon ainda enxerga a tabela — o REVOKE não pegou.';
  END IF;

  -- O caminho de escrita é o NAVEGADOR sob RLS (não há rota de servidor): sem
  -- estes quatro privilégios, o menu de filtros não salva nada e a policy nem
  -- chega a ser avaliada.
  IF NOT has_table_privilege('authenticated', 'public.cb_inbox_saved_filters', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_saved_filters', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_saved_filters', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_saved_filters', 'DELETE') THEN
    RAISE EXCEPTION '967: authenticated perdeu um privilégio que PRECISA ter.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'cb_inbox_saved_filters_nome_idx'
  ) THEN
    RAISE EXCEPTION '967: o índice único de nome não foi criado — dois "SDR" passariam.';
  END IF;
END $$;
