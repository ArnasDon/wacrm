-- 979_cb_calendly_variaveis.sql
--
-- `cb_calendly_eventos.variaveis`: as variáveis que o agendamento entregou
-- ao motor (`context.vars`, o `{{vars.agendamento_*}}` que o operador
-- escreve). Até aqui a linha guardava os CAMPOS do agendamento, mas não
-- `local`, `cancelar`, `remarcar` nem `situacao` — que só existem em forma
-- de variável.
--
-- Existe por causa do botão "Processar de novo" (rota
-- `POST /api/cb/calendly/eventos/[id]/reprocessar`): sem esta coluna, uma
-- segunda tentativa remontaria o agendamento a partir das colunas e
-- entregaria à automação um conjunto de variáveis MENOR que o da primeira
-- vez — quatro delas vazias, em silêncio. Uma mensagem montada com
-- `{{vars.agendamento_cancelar}}` sairia sem o link, e ninguém ligaria uma
-- coisa à outra.
--
-- Linha antiga fica com `{}`: o reprocessamento delas remonta o que dá a
-- partir das colunas, que é o que existe. O `DEFAULT` evita NULL — quem lê
-- espera um objeto.

ALTER TABLE cb_calendly_eventos
  ADD COLUMN IF NOT EXISTS variaveis jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cb_calendly_eventos' AND column_name = 'variaveis'
  ) THEN
    RAISE EXCEPTION '979: a coluna variaveis não foi criada.';
  END IF;
  -- Nenhum GRANT novo: a tabela é fechada para `authenticated` desde a 977
  -- (a tela lê pela rota, com service role). Coluna nova herda isso.
  IF has_column_privilege('authenticated', 'public.cb_calendly_eventos', 'variaveis', 'SELECT') THEN
    RAISE EXCEPTION '979: authenticated não pode enxergar cb_calendly_eventos.';
  END IF;
END $$;
