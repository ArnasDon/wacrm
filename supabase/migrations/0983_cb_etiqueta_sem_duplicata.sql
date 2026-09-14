-- 983_cb_etiqueta_sem_duplicata.sql
--
-- Fecha a corrida que permitia criar DUAS etiquetas com o mesmo nome.
--
-- `public.tags` nunca teve UNIQUE em `name` (nem em forma normalizada), e
-- `resolveImportTagIds` faz ler-então-inserir. Duas requisições concorrentes
-- com o mesmo nome NOVO passavam as duas pela leitura e inseriam as duas —
-- e, pior, cada uma aplicava a SUA ao contato, então o gatilho `tag_added`
-- disparava DUAS vezes. Numa automação sem etiqueta específica, isso é a
-- mensagem saindo em dobro para o cliente. São três portas com a mesma
-- corrida desde sempre: o `PATCH /api/v1/contacts/{id}`, o
-- `POST .../tags` e o import de CSV. (Achado do Codex no PR #150.)
--
-- 1) `name_key` — coluna GERADA com a régua de "mesma etiqueta": aparada,
--    sem acento, em minúsculas.
--    ⚠️ Coluna gerada, e não índice sobre expressão, pelo mesmo motivo da
--    022 (`contacts.phone_normalized`): o `on_conflict` do PostgREST aceita
--    NOME DE COLUNA, não expressão. Sem a coluna, nenhuma das três portas
--    conseguiria inserir com `ON CONFLICT DO NOTHING`.
--    ⚠️ Tem GÊMEO EM TS: `chaveDeTag`, em `src/lib/contacts/chave-de-tag.ts`.
--    O `translate` abaixo cobre a lista latina que o português usa; o TS
--    apaga TODO sinal combinante (`\p{Mn}`), ou seja, colapsa MAIS. A folga
--    é deliberada e cai para o lado seguro: o código considera "é a mesma" e
--    nem tenta criar, então o banco nunca recusa criação legítima. O
--    contrário — SQL colapsando mais que o código — faria o código pedir uma
--    etiqueta nova, levar 23505 e a etiqueta sumir em silêncio.
--    ⚠️ `btrim(name, E' \t\r\n')` com a lista escrita: o `btrim` de um
--    argumento só apara U+0020, e o `.trim()` do JS apara todo espaço em
--    branco (a mesma divergência que a busca da 929 já documenta).
--
-- 2) Duplicatas que JÁ existem são RENOMEADAS, nunca apagadas. Apagar
--    parecia mais limpo e é a opção errada: `tags.id` é referenciado por
--    `contact_tags` (FK), mas TAMBÉM por JSON que nenhuma FK protege —
--    `automations.trigger_config.tag_id`, `automation_steps.step_config`,
--    a config dos nós de fluxo e o recorte salvo da caixa de entrada (967).
--    Apagar a perdedora deixaria essas regras apontando para um id que não
--    existe mais, e elas parariam de casar EM SILÊNCIO. Renomear preserva
--    todo id e deixa a decisão de fundir com o operador, que vê o sufixo no
--    catálogo.
--
-- 3) O índice único por conta.
--
-- Medido em 2026-09-09, antes de aplicar: ZERO duplicatas nesta instalação
-- pelas duas réguas candidatas — o passo (2) é no-op aqui e existe para
-- quem instalar com dado já sujo.

-- ---------------------------------------------------------------------------
-- 1) a chave
-- ---------------------------------------------------------------------------
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS name_key text
  GENERATED ALWAYS AS (
    lower(
      translate(
        btrim(name, E' \t\r\n'),
        'àáâãäåèéêëìíîïòóôõöùúûüýÿçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÇÑ',
        'aaaaaaeeeeiiiiooooouuuuyycnAAAAAAEEEEIIIIOOOOOUUUUYCN'
      )
    )
  ) STORED;

-- ---------------------------------------------------------------------------
-- 2) desempata o que já existe — RENOMEANDO, nunca apagando
-- ---------------------------------------------------------------------------
-- A vencedora é a MAIS ANTIGA (`created_at`, depois `id`), a mesma régua que
-- `aplicarMudancaDeTags` usa ao ler o catálogo — é a que o escritório vem
-- usando. `NULLS LAST` porque `tags.created_at` é anulável (001) e o
-- PostgREST ordena assim; carimbo desconhecido não vence carimbo conhecido.
--
-- O sufixo é o começo do id: feio de propósito, para o operador achar e
-- resolver, e único por construção — um sufixo "bonito" como " (2)" podia
-- colidir com uma etiqueta que já se chamasse assim.
DO $$
DECLARE
  v_renomeadas integer;
BEGIN
  WITH ordenadas AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY account_id, name_key
             ORDER BY created_at ASC NULLS LAST, id ASC
           ) AS posicao
      FROM tags
  ),
  perdedoras AS (
    SELECT id FROM ordenadas WHERE posicao > 1
  )
  UPDATE tags t
     SET name = t.name || ' (' || left(t.id::text, 8) || ')'
    FROM perdedoras p
   WHERE p.id = t.id;

  GET DIAGNOSTICS v_renomeadas = ROW_COUNT;
  IF v_renomeadas > 0 THEN
    RAISE NOTICE '983: % etiqueta(s) duplicada(s) renomeada(s) com sufixo — o operador decide se funde', v_renomeadas;
  ELSE
    RAISE NOTICE '983: nenhuma etiqueta duplicada a desempatar.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) o índice
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tags_conta_nome_uk
  ON tags (account_id, name_key);

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sobrando integer;
BEGIN
  -- A coluna existe E é gerada. `ADD COLUMN IF NOT EXISTS` é silencioso
  -- quando a coluna já existe com OUTRA expressão, então não basta olhar o
  -- nome.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tags'::regclass
      AND attname = 'name_key'
      AND attgenerated = 's'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '983: tags.name_key ausente ou não é coluna GERADA';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'tags' AND indexname = 'tags_conta_nome_uk'
  ) THEN
    RAISE EXCEPTION '983: índice único (account_id, name_key) ausente — a corrida continua aberta';
  END IF;

  -- Afirmação de AUSÊNCIA: verdade trivial num banco vazio, e prova de
  -- verdade num banco com dado.
  SELECT count(*) INTO v_sobrando
    FROM (
      SELECT 1 FROM tags GROUP BY account_id, name_key HAVING count(*) > 1
    ) x;
  IF v_sobrando > 0 THEN
    RAISE EXCEPTION '983: % chave(s) ainda duplicada(s) depois do desempate', v_sobrando;
  END IF;

  -- A régua do TS e a do SQL têm de concordar nos casos que motivaram isto.
  IF (SELECT lower(translate(btrim('  Bancário  ', E' \t\r\n'),
        'àáâãäåèéêëìíîïòóôõöùúûüýÿçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÇÑ',
        'aaaaaaeeeeiiiiooooouuuuyycnAAAAAAEEEEIIIIOOOOOUUUUYCN'))) <> 'bancario' THEN
    RAISE EXCEPTION '983: a normalização do nome não bate com chaveDeTag (src/lib/contacts/chave-de-tag.ts)';
  END IF;
  IF (SELECT lower(translate(btrim('AÇÃO', E' \t\r\n'),
        'àáâãäåèéêëìíîïòóôõöùúûüýÿçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÇÑ',
        'aaaaaaeeeeiiiiooooouuuuyycnAAAAAAEEEEIIIIOOOOOUUUUYCN'))) <> 'acao' THEN
    RAISE EXCEPTION '983: a normalização do nome não bate com chaveDeTag (src/lib/contacts/chave-de-tag.ts)';
  END IF;
END $$;
