-- ============================================================
-- 927 — Sinal de vida do agendador (F4)
--
-- ⚠️ POR QUE ISTO EXISTE, EM UMA FRASE: sem batimento, agendador morto e dia
-- sem mensagem produzem EXATAMENTE o mesmo silêncio.
--
-- O disparador só deixava rastro quando tinha trabalho. Pior: a proteção que
-- recusa agendada atrasada roda DENTRO do ciclo — se o ciclo não roda, ela não
-- roda, e as linhas ficam eternamente "Agendada", prometendo um envio que não
-- vem. Este projeto já viveu isso na forma mais cara possível: o cron das
-- automações NUNCA rodou em produção e ninguém percebeu por semanas, porque
-- nada dependia dele. Agora vai depender — é mensagem para cliente de
-- escritório de advocacia.
--
-- Com esta linha, "o agendador está vivo?" vira uma pergunta que a TELA
-- responde, sem ninguém precisar abrir o banco.
--
-- ⚠️ NÃO é por conta. O agendador é um só para a instalação inteira, e a
-- pergunta que ele responde ("o processo externo bateu na rota?") também. Por
-- isso a leitura é liberada a qualquer membro autenticado: o conteúdo é um
-- carimbo de tempo e um contador, sem nada de cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS cb_agendador_batimento (
  -- Truque de linha única: `boolean` com CHECK de verdadeiro só admite um
  -- valor possível, então a PK garante que nunca haja uma segunda linha. Sem
  -- isso, um `insert` distraído criaria um segundo batimento e a tela passaria
  -- a ler um dos dois, ao acaso.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  /** Quando o ciclo terminou pela última vez. É o dado todo. */
  ultimo_ciclo timestamptz NOT NULL DEFAULT now(),

  /** O que o último ciclo fez. Só para diagnóstico na tela. */
  enviadas_no_ultimo integer NOT NULL DEFAULT 0,
  falhas_no_ultimo integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE cb_agendador_batimento IS
  'Sinal de vida do agendador externo. Uma linha só, reescrita a cada ciclo. Carimbo velho = o processo que bate em /api/cb/scheduled/cron parou.';

-- Semeia a linha com um carimbo ANTIGO, de propósito: até o agendador subir de
-- verdade, a tela deve dizer "não está rodando" — que é a verdade. Semear com
-- `now()` faria a tela mentir "tudo certo" numa instalação sem agendador.
INSERT INTO cb_agendador_batimento (id, ultimo_ciclo)
VALUES (true, 'epoch'::timestamptz)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE cb_agendador_batimento ENABLE ROW LEVEL SECURITY;

-- LER: qualquer membro autenticado. Não há o que escopar — é estado de
-- infraestrutura, não dado de cliente.
DROP POLICY IF EXISTS cb_agendador_batimento_select ON cb_agendador_batimento;
CREATE POLICY cb_agendador_batimento_select ON cb_agendador_batimento FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ⚠️ Escrever é só do worker, em service-role. E o REVOKE não é redundante com
-- a ausência de policy: sem ele, um UPDATE do navegador não acha linha e volta
-- "0 linhas afetadas", que toda tela lê como sucesso — alguém "consertaria" o
-- batimento pela tela e o aviso sumiria com o agendador ainda morto.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_agendador_batimento FROM authenticated, anon;
REVOKE ALL ON cb_agendador_batimento FROM anon;
GRANT SELECT ON cb_agendador_batimento TO authenticated;

-- ------------------------------------------------------------
-- Conferir o RESULTADO, não a intenção
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM cb_agendador_batimento) <> 1 THEN
    RAISE EXCEPTION '927: esperava exatamente 1 linha de batimento, achei %.',
      (SELECT count(*) FROM cb_agendador_batimento);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_agendador_batimento'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '927: RLS não ficou ligada.';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'DELETE') THEN
    RAISE EXCEPTION '927: authenticated ainda escreve no batimento — o REVOKE não pegou.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_agendador_batimento', 'SELECT') THEN
    RAISE EXCEPTION '927: anon enxerga o batimento.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'SELECT') THEN
    RAISE EXCEPTION '927: authenticated perdeu a leitura — a tela depende dela.';
  END IF;
END $$;
