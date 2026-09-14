-- 984_cb_chave_de_tag_normalizada.sql
--
-- Fecha um furo no backstop que a 983 acabou de criar.
--
-- A 983 normalizou `tags.name_key` com um `translate` de acentos
-- PRECOMPOSTOS (`á` = U+00E1). Só que "Bancário" tem DUAS formas Unicode
-- canonicamente equivalentes: a precomposta e a DECOMPOSTA (`a` + U+0301),
-- que é a que sai de exportação feita no macOS e de vários geradores de CSV.
--
-- O `chaveDeTag` do TypeScript já tratava as duas iguais (ele faz
-- `.normalize('NFD')` ANTES de apagar os sinais combinantes). O SQL não:
-- MEDIDO em 2026-09-09, a 983 devolvia `bancario` para o precomposto e
-- `bancário` para o decomposto. Ou seja, o índice único deixava as duas
-- formas entrarem, e o backstop não segurava justamente o caso em que o
-- código também não conseguiria decidir sozinho — com as duas inserções
-- concorrentes, cada requisição podia reler antes do commit da outra,
-- aplicar ids DIFERENTES ao contato e disparar `tag_added` duas vezes.
-- (Achado do Codex no PR #151.)
--
-- A régua nova faz o que o TS faz, e nada mais: decompõe (NFD) e apaga os
-- sinais combinantes do bloco U+0300–U+036F. Ela colapsa TUDO que a 983
-- colapsava, mais as formas decompostas — então é superconjunto, e nenhum
-- nome que era distinto passa a colidir. Conferido antes de aplicar: zero
-- colisões novas nesta instalação.
--
-- ⚠️ `normalize(text, NFD)` é IMMUTABLE (`provolatile = 'i'`), que é o que
-- permite usá-la em coluna GERADA. Conferido no catálogo antes de escrever.
-- ⚠️ O `\u0300` do padrão é escape da ARE do Postgres, não do literal SQL:
-- com `standard_conforming_strings = on` a barra invertida chega inteira ao
-- motor de regex, que entende `\uXXXX`. Conferido: `regexp_replace('aXb',
-- '[\u0058]', '', 'g')` devolve `ab` (U+0058 é `X`). Escrito por escape DE
-- PROPÓSITO: pôr os caracteres combinantes literais no arquivo os tornaria
-- invisíveis para quem for ler ou editar isto depois.
--
-- A coluna é RECRIADA (drop + add) em vez de `ALTER ... SET EXPRESSION`:
-- aquela sintaxe só existe no PG 17, e a migration precisa replayar no
-- Postgres que o CI subir. Dropar a coluna leva o índice junto.

-- ---------------------------------------------------------------------------
-- 1) a chave, agora insensível também à forma de composição
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS tags_conta_nome_uk;
ALTER TABLE tags DROP COLUMN IF EXISTS name_key;

ALTER TABLE tags
  ADD COLUMN name_key text
  GENERATED ALWAYS AS (
    regexp_replace(
      normalize(lower(btrim(name, E' \t\r\n')), NFD),
      '[\u0300-\u036f]', '', 'g'
    )
  ) STORED;

-- ---------------------------------------------------------------------------
-- 2) desempata o que a régua nova aproxima — RENOMEANDO, nunca apagando
-- ---------------------------------------------------------------------------
-- Mesmo racional da 983: `tags.id` é referenciado por JSON que nenhuma FK
-- protege (`automations.trigger_config.tag_id`, `automation_steps.step_config`,
-- config de nó de fluxo, o recorte salvo da caixa de entrada da 967), e
-- apagar deixaria essas regras apontando para um id morto, parando de casar
-- EM SILÊNCIO.
--
-- ⚠️ O que o operador PODE fazer com a renomeada é limitado, e vale dizer
-- em vez de sugerir o contrário: o app não tem renomear nem fundir etiqueta
-- — só criar e excluir (`tag-manager.tsx`). Na prática ele reetiqueta os
-- contatos com a que ficou e apaga a do sufixo. A renomeação existe para
-- que ele VEJA que havia duas e decida, não porque exista um botão de
-- fusão. (Achado da revisão adversarial.)
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
    RAISE NOTICE '984: % etiqueta(s) em forma decomposta renomeada(s) — o operador decide se funde', v_renomeadas;
  ELSE
    RAISE NOTICE '984: nenhuma etiqueta a desempatar.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) o índice de volta
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tags_conta_nome_uk
  ON tags (account_id, name_key);

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sobrando integer;
  v_pre text;
  v_dec text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tags'::regclass
      AND attname = 'name_key' AND attgenerated = 's' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '984: tags.name_key ausente ou não é coluna GERADA';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'tags' AND indexname = 'tags_conta_nome_uk'
  ) THEN
    RAISE EXCEPTION '984: índice único (account_id, name_key) ausente — a corrida continua aberta';
  END IF;

  -- O QUE ESTA MIGRATION EXISTE PARA GARANTIR: as duas formas Unicode do
  -- mesmo nome produzem a MESMA chave. Com a régua da 983 esta conferência
  -- reprovava.
  SELECT regexp_replace(normalize(lower(btrim('Bancário', E' \t\r\n')), NFD), '[\u0300-\u036f]', '', 'g')
    INTO v_pre;
  SELECT regexp_replace(normalize(lower(btrim(normalize('Bancário', NFD), E' \t\r\n')), NFD), '[\u0300-\u036f]', '', 'g')
    INTO v_dec;
  IF v_pre <> 'bancario' OR v_dec <> 'bancario' THEN
    RAISE EXCEPTION '984: precomposto=% decomposto=% — as duas formas deviam dar "bancario"', v_pre, v_dec;
  END IF;

  -- E o que ela NÃO pode fazer: colapsar nomes de fato diferentes.
  IF regexp_replace(normalize(lower(btrim('Bancária', E' \t\r\n')), NFD), '[\u0300-\u036f]', '', 'g') = 'bancario' THEN
    RAISE EXCEPTION '984: a régua colapsou "Bancária" com "Bancário"';
  END IF;
  -- O acento que existe SOZINHO não é sinal combinante e tem de sobreviver,
  -- como no TS (`\p{Mn}`, nunca `\p{Diacritic}`).
  IF regexp_replace(normalize(lower(btrim('a^b', E' \t\r\n')), NFD), '[\u0300-\u036f]', '', 'g') <> 'a^b' THEN
    RAISE EXCEPTION '984: a régua comeu um acento solto — divergiria do chaveDeTag';
  END IF;

  SELECT count(*) INTO v_sobrando
    FROM (SELECT 1 FROM tags GROUP BY account_id, name_key HAVING count(*) > 1) x;
  IF v_sobrando > 0 THEN
    RAISE EXCEPTION '984: % chave(s) ainda duplicada(s) depois do desempate', v_sobrando;
  END IF;
END $$;
