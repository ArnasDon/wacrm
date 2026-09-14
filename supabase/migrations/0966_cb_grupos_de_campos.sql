-- ============================================================
-- 966 — Grupos de campos personalizados + ordem dentro do grupo
--
-- Pedido do operador em 2026-08-31, olhando o painel da conversa: os campos
-- personalizados apareciam numa lista única, em ordem ALFABÉTICA, e os de
-- traqueamento moravam numa aba separada (949). Ele quer blocos que ele mesmo
-- nomeia — "Bancário", "Trabalhista", "Traqueamento" — e a ordem dos campos
-- dentro de cada bloco decidida por ele, valendo para TODO cliente.
--
-- ⚠️ POR QUE UMA TABELA, E NÃO TEXTO LIVRE COMO EM `cb_media_library`
-- No acervo (953) a categoria é texto livre de propósito: nada depende da
-- ORDEM das categorias nem de renomear uma sem tocar nas linhas. Aqui as duas
-- coisas são o pedido: o operador escolhe que bloco vem primeiro na ficha do
-- cliente, e renomear "Bancário" não pode significar reescrever N campos.
-- Ordem de bloco não tem onde morar em texto livre sem denormalizar a posição
-- em cada campo — que é a forma de as duas verdades divergirem.
--
-- ⚠️ `grupo_id` NULO É O BLOCO "GERAL", E ELE VEM PRIMEIRO.
-- Decisão do operador. Campo sem grupo cai num bloco fixo, no topo, que a tela
-- rotula pelo dicionário — não existe linha para ele, então ele não é
-- renomeável nem arrastável. Em compensação ele SOME sozinho quando todo campo
-- estiver num grupo de verdade (bloco vazio não renderiza), e os campos gerais
-- que já existem não precisam ser migrados para lugar nenhum.
--
-- ⚠️ `categoria` (949) NÃO MORRE E NÃO É O GRUPO.
-- São perguntas diferentes: `categoria='tracking'` diz que o campo é TÉCNICO
-- (é o que a futura integração com a API de Conversões da Meta vai ler, e é o
-- que o semeador dos 10 campos padrão escreve), enquanto `grupo_id` diz só
-- ONDE ele aparece na tela. A API pública v1 já expõe `category` no payload
-- desde a Fase 6 — dropar a coluna quebraria o n8n do gestor. O que sai é o
-- SELETOR de categoria no formulário de criação: quem cria campo agora escolhe
-- GRUPO, e a categoria fica no default ('geral').
--
-- ⚠️ A ESCRITA É DIRETA, SOB RLS — ao contrário do acervo (953).
-- O catálogo de `custom_fields` sempre foi escrito assim: o navegador insere,
-- renomeia e apaga direto, com policies exigindo admin. Um grupo é um nome e
-- um número; não há coluna derivada nem carimbo de servidor a proteger, então
-- rotear por API só criaria uma segunda régua de papel para manter em sincronia
-- com a que já existe na tabela irmã.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela dos grupos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_grupos_de_campos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- O rótulo do bloco na ficha do cliente. Teto igual ao da categoria do
  -- acervo: é cabeçalho de coluna estreita, não descrição.
  nome text NOT NULL CHECK (btrim(nome) <> '' AND length(nome) <= 60),

  -- Ordem dos BLOCOS entre si. Empate cai no nome (a consulta desempata), o
  -- que só acontece em grupo criado por outro caminho — a tela grava max+1.
  posicao integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Alvo da FK COMPOSTA de `custom_fields` (padrão da 903/908): as rotas v1 e
-- a ingestão rodam em service-role e ignoram RLS, então uma FK simples só
-- garantiria "existe uma linha com esse id" — inclusive de outra conta.
CREATE UNIQUE INDEX IF NOT EXISTS cb_grupos_de_campos_id_conta
  ON cb_grupos_de_campos (id, account_id);

-- Dois blocos "Bancário" na mesma tela são indistinguíveis, e o operador não
-- teria como saber em qual dos dois o campo caiu. Sem caixa e sem espaço nas
-- pontas, porque "bancário " é o mesmo bloco para quem lê.
CREATE UNIQUE INDEX IF NOT EXISTS cb_grupos_de_campos_nome_unico
  ON cb_grupos_de_campos (account_id, lower(btrim(nome)));

-- ------------------------------------------------------------
-- 2) As duas colunas novas em custom_fields
-- ------------------------------------------------------------
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS grupo_id uuid,
  -- Posição DENTRO do grupo. Anulável de propósito: campo criado por qualquer
  -- caminho que não a saiba (o semeador de traqueamento, uma rota futura) cai
  -- no FIM do bloco — as consultas ordenam com NULLS LAST e desempatam pelo
  -- nome. Sem isso, todo escritor novo de `custom_fields` viraria um lugar a
  -- mais para esquecer de carimbar a ordem.
  ADD COLUMN IF NOT EXISTS posicao integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_grupo_fkey'
  ) THEN
    -- ⚠️ `SET NULL (grupo_id)`, com a coluna nomeada: `account_id` é NOT NULL,
    -- e um SET NULL sem lista tentaria zerar as DUAS colunas da chave — apagar
    -- um grupo passaria a estourar violação de NOT NULL em vez de devolver os
    -- campos ao bloco Geral.
    ALTER TABLE custom_fields
      ADD CONSTRAINT custom_fields_grupo_fkey
      FOREIGN KEY (grupo_id, account_id)
      REFERENCES cb_grupos_de_campos (id, account_id)
      ON DELETE SET NULL (grupo_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3) Migração dos dados que já existem
--
-- Não é seed de catálogo (que o CLAUDE.md proíbe em migration): é a
-- reorganização de linhas que JÁ estão na conta. O grupo "Traqueamento" nasce
-- apenas para as contas que de fato têm campo `categoria='tracking'`; conta
-- sem nenhum não ganha bloco vazio.
-- ------------------------------------------------------------
INSERT INTO cb_grupos_de_campos (account_id, nome, posicao)
SELECT DISTINCT cf.account_id, 'Traqueamento', 1
  FROM custom_fields cf
 WHERE cf.categoria = 'tracking'
ON CONFLICT DO NOTHING;

UPDATE custom_fields cf
   SET grupo_id = g.id
  FROM cb_grupos_de_campos g
 WHERE g.account_id = cf.account_id
   AND lower(btrim(g.nome)) = 'traqueamento'
   AND cf.categoria = 'tracking'
   AND cf.grupo_id IS NULL;

-- A ordem inicial é o ALFABÉTICO que a tela mostra hoje: no dia do deploy nada
-- muda de lugar, e a primeira vez que alguém arrastar é a primeira vez que a
-- ordem deixa de ser alfabética.
UPDATE custom_fields cf
   SET posicao = o.ord
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY account_id, grupo_id ORDER BY field_name
           ) AS ord
      FROM custom_fields
  ) o
 WHERE o.id = cf.id
   AND cf.posicao IS NULL;

-- ------------------------------------------------------------
-- 4) RLS + privilégios da tabela nova
-- ------------------------------------------------------------
ALTER TABLE cb_grupos_de_campos ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro. O bloco é rótulo de tela — esconder o nome de um
-- `viewer` só faria os campos daquele bloco aparecerem sem cabeçalho.
DROP POLICY IF EXISTS cb_grupos_de_campos_select ON cb_grupos_de_campos;
CREATE POLICY cb_grupos_de_campos_select ON cb_grupos_de_campos FOR SELECT
  USING (is_account_member(account_id));

-- Escrever: admin, exatamente como as policies de `custom_fields` (948).
DROP POLICY IF EXISTS cb_grupos_de_campos_insert ON cb_grupos_de_campos;
CREATE POLICY cb_grupos_de_campos_insert ON cb_grupos_de_campos FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_grupos_de_campos_update ON cb_grupos_de_campos;
CREATE POLICY cb_grupos_de_campos_update ON cb_grupos_de_campos FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_grupos_de_campos_delete ON cb_grupos_de_campos;
CREATE POLICY cb_grupos_de_campos_delete ON cb_grupos_de_campos FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ⚠️ Tabela cb_* nasce sem nada para `anon` (regra do CLAUDE.md, escrita
-- depois de a 901/906/912 deixarem concessão aberta), e o que os outros papéis
-- precisam vai ESCRITO — o default privilege do Supabase não existe em banco
-- novo, e é lá que o CI reaplica tudo do zero.
REVOKE ALL ON cb_grupos_de_campos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_grupos_de_campos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_grupos_de_campos TO service_role;

-- ⚠️ E o privilégio da tabela ANTIGA, que esta migration passa a DEPENDER.
-- `custom_fields` é do upstream (001) e nunca concedeu nada por escrito: em
-- produção o default privilege do Supabase já deu tudo, mas num banco novo —
-- que é onde o CI replaya — a RPC de ordenação abaixo, e o catálogo inteiro,
-- rodariam sem UPDATE. Em produção este GRANT é no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_fields TO service_role;

-- ------------------------------------------------------------
-- 5) As duas RPCs de ordenação
--
-- ⚠️ POR QUE RPC, E NÃO O `upsert` DE LINHA INTEIRA DO `pipeline-settings`
-- Reordenar mexe em UMA coluna. O upsert do PostgREST precisaria carregar
-- junto as quatro colunas NOT NULL de `custom_fields` (`user_id`,
-- `field_name`, `field_key`, `account_id`) — o NOT NULL é conferido ANTES de o
-- Postgres decidir pelo ramo do ON CONFLICT, então mandar só o id não passa —,
-- e é assim que um arrastar passa a poder reescrever o NOME de um campo com um
-- valor velho do estado da tela. Este projeto já pagou por isso em
-- `/api/ai/config` (salvar de uma tela apagava campo de outra).
--
-- Ambas SECURITY INVOKER: quem decide quem pode reordenar são as policies de
-- admin que já existem nas duas tabelas. Nada aqui precisa de poder extra.
-- ------------------------------------------------------------

-- Ordem dos campos DENTRO do bloco, e de quebra o bloco de cada campo — as
-- duas coisas mudam no mesmo gesto (arrastar dentro do bloco / trocar o bloco
-- no seletor da linha), então separá-las em duas chamadas só criaria um
-- instante em que a tela e o banco discordam.
CREATE OR REPLACE FUNCTION cb_ordenar_campos_personalizados(p_campos jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_afetados integer;
BEGIN
  UPDATE custom_fields cf
     SET grupo_id = NULLIF(item->>'grupo_id', '')::uuid,
         posicao  = (item->>'posicao')::integer
    FROM jsonb_array_elements(p_campos) AS item
   WHERE cf.id = (item->>'id')::uuid;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;
  RETURN v_afetados;
END;
$$;

-- Ordem dos BLOCOS entre si. Recebe os ids na ordem desejada e grava a posição
-- pela `ordinality` — assim a tela manda o que ela mostra, não uma aritmética
-- de posições que pode divergir dela.
CREATE OR REPLACE FUNCTION cb_ordenar_grupos_de_campos(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_afetados integer;
BEGIN
  UPDATE cb_grupos_de_campos g
     SET posicao = o.ord
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE g.id = o.id;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;
  RETURN v_afetados;
END;
$$;

-- ⚠️ As duas metades do REVOKE (o CLAUDE.md as documenta depois de três
-- enganos seguidos: a forma da concessão varia por função, e olhar só uma
-- delas engana). Aqui `authenticated` PRECISA continuar executando — quem
-- arrasta é o navegador do admin —, então ele só perde o que vinha de PUBLIC e
-- recebe de volta por escrito.
REVOKE EXECUTE ON FUNCTION cb_ordenar_campos_personalizados(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cb_ordenar_campos_personalizados(jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION cb_ordenar_grupos_de_campos(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cb_ordenar_grupos_de_campos(uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Conferência — só FORMA, segura em banco vazio
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sem_grupo integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_grupo_fkey'
  ) THEN
    RAISE EXCEPTION '966: a FK composta do grupo não foi criada — campo poderia apontar para grupo de outra conta.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'cb_grupos_de_campos_nome_unico'
  ) THEN
    RAISE EXCEPTION '966: o índice de nome único não foi criado — dariam para existir dois blocos com o mesmo nome.';
  END IF;

  -- Afirmação de AUSÊNCIA: verdade trivial em banco vazio, e o que interessa
  -- num banco com dados. Campo de traqueamento que ficou fora do bloco seria
  -- campo sumido da aba antiga sem ter aparecido em bloco nenhum.
  SELECT count(*) INTO v_sem_grupo
    FROM custom_fields
   WHERE categoria = 'tracking' AND grupo_id IS NULL;
  IF v_sem_grupo > 0 THEN
    RAISE EXCEPTION '966: % campo(s) de traqueamento ficaram sem grupo.', v_sem_grupo;
  END IF;

  IF has_table_privilege('anon', 'public.cb_grupos_de_campos', 'SELECT') THEN
    RAISE EXCEPTION '966: anon enxerga cb_grupos_de_campos.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_grupos_de_campos', 'INSERT') THEN
    RAISE EXCEPTION '966: authenticated não insere grupo — a tela de Configurações não criaria bloco.';
  END IF;

  IF has_function_privilege('anon', 'public.cb_ordenar_campos_personalizados(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ordenar_grupos_de_campos(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '966: anon executa as RPCs de ordenação.';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER confere o privilégio de TUDO que roda dentro, como quem
-- chamou — e o bloco acima roda como DONO, então passaria verde mesmo se
-- `authenticated` não conseguisse executar. Este é o teste que pega (recipe do
-- CLAUDE.md, escrita depois de a 929 quase ir para produção assim).
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  -- Lista vazia: nenhuma linha muda, e sob RLS sem sessão não haveria o que
  -- mudar de qualquer forma. O que se prova aqui é o privilégio, não o efeito.
  PERFORM public.cb_ordenar_campos_personalizados('[]'::jsonb);
  PERFORM public.cb_ordenar_grupos_de_campos(ARRAY[]::uuid[]);
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '966: authenticated não consegue executar as RPCs de ordenação: %', SQLERRM;
END $$;
