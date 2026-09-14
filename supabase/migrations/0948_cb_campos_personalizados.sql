-- ============================================================
-- 948 — Campos personalizados: identificador estável + tipos novos
--
-- O operador pediu (2026-08-29, plano em docs/PLANO-painel-do-contato.md):
-- todo campo personalizado precisa de um IDENTIFICADOR estável e legível
-- (`field_key`) para a futura API preencher campos por nome, e o catálogo
-- ganha dois tipos novos: `select` (lista de opções) e `number`.
--
-- O que esta migration faz:
--   1) `custom_fields.field_key` — slug único por conta, NOT NULL.
--   2) Gatilho BEFORE INSERT que GERA a chave quando ela vem vazia.
--   3) CHECK fechando `field_type` em (text, datetime, select, number).
--
-- ⚠️ POR QUE UM GATILHO, e não só NOT NULL + UI nova:
-- Entre aplicar esta migration e o deploy da Fase 2, a PRODUÇÃO continua
-- rodando o código velho, que insere campo sem `field_key` — um NOT NULL
-- seco quebraria "Adicionar campo" em produção nessa janela. E todo merge
-- do upstream traz de volta um gerenciador que não conhece a coluna. O
-- gatilho torna a coluna auto-suficiente: quem não a preencher ganha um
-- slug derivado do nome, com dedupe por conta.
--
-- ⚠️ A CHAVE É ADITIVA. Automações (`custom:<uuid>`), lembrete por data
-- (935/947) e merge-tags de broadcast continuam referenciando o campo por
-- UUID. Nenhum consumidor migra — a chave existe PARA a API pública.
--
-- ⚠️ `value` em `contact_custom_values` segue TEXT para TODOS os tipos.
-- Número e opção são convenção de UI; é o que mantém o motor de automações
-- (`update_contact_field` grava texto livre) e os filtros de broadcast
-- funcionando sem mexer em nada.
--
-- ⚠️ `field_options` (JSONB) existe desde a 001 e NUNCA foi usada — passa a
-- guardar as opções do tipo `select` como OBJETO `{"opcoes": ["A", "B"]}`
-- (é o que todo escritor/leitor real usa: `custom-fields-manager`,
-- `campo-opcoes.ts` e a serialização da API v1 — comentário corrigido na
-- revisão de 2026-08-29; antes dizia "array de strings" e mentia). Nenhuma
-- coluna nova além da chave.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A coluna
-- ------------------------------------------------------------
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS field_key TEXT;

-- ------------------------------------------------------------
-- 2) O gerador de slug — puro e IMMUTABLE.
--
-- Minúsculas, acentos comuns do pt-BR traduzidos, qualquer outra coisa
-- vira `_`, bordas aparadas, teto de 60. Vazio (nome só de símbolos)
-- degrada para 'campo'. O TypeScript tem um GÊMEO desta função em
-- `src/lib/contacts/chave-do-campo.ts` (com teste de paridade) — quem
-- mudar a regra aqui muda lá na mesma passada, senão a chave sugerida na
-- tela diverge da que o banco geraria.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_chave_de_campo(nome TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      btrim(
        left(
          btrim(
            regexp_replace(
              translate(
                lower(COALESCE(nome, '')),
                'áàâãäéèêëíìîïóòôõöúùûüçñ',
                'aaaaaeeeeiiiiooooouuuucn'
              ),
              '[^a-z0-9]+', '_', 'g'
            ),
            '_'
          ),
          60
        ),
        '_'
      ),
      ''
    ),
    'campo'
  )
$$;

-- ------------------------------------------------------------
-- 3) O gatilho: chave ausente → gera com dedupe por conta.
--
-- Roda como QUEM INSERE (SECURITY INVOKER). O EXISTS enxerga a tabela sob
-- a RLS do papel: `authenticated` só vê a própria conta — que é EXATAMENTE
-- o recorte do dedupe. `service_role` vê tudo, mas o filtro de
-- `account_id` mantém o mesmo recorte. Corrida entre dois inserts
-- simultâneos com o mesmo nome cai no índice único do passo 6 — o segundo
-- recebe 23505 e a UI trata como "tente outro nome".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_custom_fields_chave()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT;
  k TEXT;
  n INT := 1;
BEGIN
  IF NEW.field_key IS NOT NULL AND btrim(NEW.field_key) <> '' THEN
    -- Chave explícita: só normaliza pelas mesmas regras do gerador, para a
    -- API nunca precisar adivinhar maiúsculas/acentos.
    NEW.field_key := cb_chave_de_campo(NEW.field_key);
    RETURN NEW;
  END IF;

  base := cb_chave_de_campo(NEW.field_name);
  k := base;
  WHILE EXISTS (
    SELECT 1 FROM custom_fields
    WHERE account_id = NEW.account_id AND field_key = k
  ) LOOP
    n := n + 1;
    k := base || '_' || n;
  END LOOP;
  NEW.field_key := k;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_custom_fields_chave_trigger ON custom_fields;
CREATE TRIGGER cb_custom_fields_chave_trigger
  BEFORE INSERT ON custom_fields
  FOR EACH ROW
  EXECUTE FUNCTION cb_custom_fields_chave();

-- ------------------------------------------------------------
-- 4) Backfill dos campos existentes (produção tem 3; banco limpo, zero).
-- Laço linha a linha de propósito: usa o MESMO dedupe do gatilho e é
-- imune a colisão com chaves já preenchidas numa re-execução parcial.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  base TEXT;
  k TEXT;
  n INT;
  total INT := 0;
BEGIN
  FOR r IN
    SELECT id, account_id, field_name
    FROM custom_fields
    WHERE field_key IS NULL
    ORDER BY created_at, id
  LOOP
    base := cb_chave_de_campo(r.field_name);
    k := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM custom_fields
      WHERE account_id = r.account_id AND field_key = k
    ) LOOP
      n := n + 1;
      k := base || '_' || n;
    END LOOP;
    UPDATE custom_fields SET field_key = k WHERE id = r.id;
    total := total + 1;
  END LOOP;
  IF total = 0 THEN
    RAISE NOTICE '948: nenhum campo sem chave (banco vazio ou re-execução).';
  ELSE
    RAISE NOTICE '948: % campo(s) receberam field_key no backfill.', total;
  END IF;
END $$;

-- Com gatilho preenchendo o futuro e backfill cobrindo o passado, o
-- NOT NULL é seguro — inclusive para o código velho que roda em produção
-- até o deploy da Fase 2.
ALTER TABLE custom_fields ALTER COLUMN field_key SET NOT NULL;

-- ------------------------------------------------------------
-- 5) Unicidade por conta. Índice ÚNICO TOTAL (sem WHERE) — serve de alvo
-- para ON CONFLICT se um dia for preciso, ao contrário dos parciais da 903.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS cb_custom_fields_conta_chave_idx
  ON custom_fields (account_id, field_key);

-- ------------------------------------------------------------
-- 6) Tipos: normaliza lixo eventual e fecha o universo.
-- `field_type` sempre foi TEXT livre; só a UI o escrevia (text/datetime),
-- mas o CHECK não pode apostar nisso.
-- ------------------------------------------------------------
UPDATE custom_fields
SET field_type = 'text'
WHERE field_type NOT IN ('text', 'datetime', 'select', 'number');

ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS cb_custom_fields_tipo_check;
ALTER TABLE custom_fields ADD CONSTRAINT cb_custom_fields_tipo_check
  CHECK (field_type IN ('text', 'datetime', 'select', 'number'));

-- ------------------------------------------------------------
-- 7) Privilégios — as duas metades, como manda o CLAUDE.md.
--
-- `cb_chave_de_campo` PRECISA de EXECUTE para `authenticated`: o gatilho é
-- SECURITY INVOKER e a chama como o papel que inseriu (a lição da 929 — o
-- privilégio de tudo que roda dentro é checado como o chamador).
-- `cb_custom_fields_chave` fecha para todos: gatilho dispara sem EXECUTE
-- (checado no CREATE TRIGGER, não a cada disparo) e ninguém a chama direto.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION cb_chave_de_campo(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cb_chave_de_campo(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION cb_custom_fields_chave() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8) Conferência — só schema e privilégio (nada que exija dado presente;
-- num banco vazio tudo abaixo continua verdadeiro).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_fields' AND column_name = 'field_key'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '948: field_key ausente ou anulável';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'cb_custom_fields_conta_chave_idx'
  ) THEN
    RAISE EXCEPTION '948: índice único da chave ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_custom_fields_tipo_check'
  ) THEN
    RAISE EXCEPTION '948: CHECK de field_type ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'cb_custom_fields_chave_trigger'
  ) THEN
    RAISE EXCEPTION '948: gatilho da chave ausente';
  END IF;

  -- As duas metades do privilégio (a forma da concessão varia por função —
  -- conferir o RESULTADO, nunca a intenção).
  IF NOT has_function_privilege('authenticated', 'cb_chave_de_campo(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '948: authenticated perdeu o EXECUTE do gerador — o gatilho SECURITY INVOKER quebraria no insert do navegador';
  END IF;
  IF has_function_privilege('anon', 'cb_chave_de_campo(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '948: anon ainda executa o gerador';
  END IF;
  IF has_function_privilege('authenticated', 'cb_custom_fields_chave()', 'EXECUTE') THEN
    RAISE EXCEPTION '948: authenticated ainda executa a função do gatilho';
  END IF;

  -- Dado, só quando houver (banco vazio pula com aviso):
  IF EXISTS (SELECT 1 FROM custom_fields) THEN
    IF EXISTS (SELECT 1 FROM custom_fields WHERE field_key IS NULL OR btrim(field_key) = '') THEN
      RAISE EXCEPTION '948: sobrou campo sem chave depois do backfill';
    END IF;
  ELSE
    RAISE NOTICE '948: banco sem campos — conferência de dados pulada.';
  END IF;
END $$;
