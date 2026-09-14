-- ============================================================
-- 937 — Batimento do laço RÁPIDO (automações)
--
-- ⚠️ POR QUE ISTO EXISTE: desde 2026-08-04 o agendador roda DOIS laços, e um
-- deles pode morrer sem ninguém perceber.
--
--   laço rápido (60 s)  → /api/automations/cron   ... em SEGUNDO plano (`&`)
--   laço lento (900 s)  → /api/cb/scheduled/cron  ... em primeiro plano
--
-- Se o laço lento cai, o `sh` termina, o contêiner morre e o Swarm reinicia:
-- visível. Se o RÁPIDO cai sozinho, o contêiner segue de pé fazendo metade do
-- trabalho — e nada acusa, porque o único batimento que existia (927) é o do
-- laço lento. A tela continuaria dizendo "agendador OK" enquanto o passo
-- "Aguardar" nunca acorda e o lembrete de reunião nunca sai.
--
-- É exatamente o modo de falha que a 927 foi criada para eliminar do outro
-- lado, e este projeto já o viveu na forma mais cara: o cron das automações
-- passou SEMANAS parado em produção sem ninguém notar, porque nada dependia
-- dele. Agora depende — lembrete de reunião é mensagem para cliente.
--
-- **Coluna, não tabela nova.** A 927 já é "sinais vitais do agendador": uma
-- linha, escrita só por service-role, lida por qualquer membro. Um segundo
-- laço do MESMO processo é a mesma coisa; tabela nova duplicaria todo o
-- aparato de RLS e REVOKE para carregar um timestamp.
-- ============================================================

ALTER TABLE public.cb_agendador_batimento
  ADD COLUMN IF NOT EXISTS ultimo_ciclo_automacoes timestamptz NOT NULL
    DEFAULT 'epoch'::timestamptz;

COMMENT ON COLUMN public.cb_agendador_batimento.ultimo_ciclo_automacoes IS
  'Fim do último ciclo do laço RÁPIDO (60s, /api/automations/cron). Carimbo velho = o laço morreu sozinho, com o contêiner ainda de pé. epoch = nunca rodou.';

-- ⚠️ `epoch`, nunca `now()` — mesma decisão da 927, pelo mesmo motivo. A linha
-- que já existe foi semeada antes desta coluna, e o DEFAULT acima só vale para
-- inserção; o UPDATE abaixo garante que a linha viva também comece dizendo a
-- VERDADE ("nunca rodou") em vez de herdar um carimbo fresco que faria a tela
-- afirmar que um laço inexistente está saudável.
UPDATE public.cb_agendador_batimento
   SET ultimo_ciclo_automacoes = 'epoch'::timestamptz
 WHERE ultimo_ciclo_automacoes IS NULL;

-- ------------------------------------------------------------
-- Conferir o RESULTADO, não a intenção.
--
-- Os privilégios são herdados da tabela (coluna nova não muda GRANT), mas o
-- bloco confere assim mesmo: é barato, e a 913/915 provaram três vezes neste
-- banco que "deve estar certo" e "está certo" são coisas diferentes.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'cb_agendador_batimento'
       AND column_name = 'ultimo_ciclo_automacoes'
  ) THEN
    RAISE EXCEPTION '937: a coluna não foi criada.';
  END IF;

  IF (SELECT count(*) FROM cb_agendador_batimento) <> 1 THEN
    RAISE EXCEPTION '937: esperava exatamente 1 linha de batimento, achei %.',
      (SELECT count(*) FROM cb_agendador_batimento);
  END IF;

  -- A linha viva tem de estar em `epoch`: se aparecer carimbo fresco aqui,
  -- alguém semeou com `now()` e a tela mentiria "laço saudável" antes de o
  -- laço existir.
  IF (SELECT ultimo_ciclo_automacoes FROM cb_agendador_batimento)
     > '1971-01-01'::timestamptz THEN
    RAISE EXCEPTION '937: o batimento das automações nasceu com carimbo fresco — a tela afirmaria saúde sem laço nenhum.';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'UPDATE')
     OR has_table_privilege('anon', 'public.cb_agendador_batimento', 'SELECT') THEN
    RAISE EXCEPTION '937: os privilégios da 927 não valem mais para esta tabela.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_agendador_batimento', 'SELECT') THEN
    RAISE EXCEPTION '937: authenticated perdeu a leitura — a tela depende dela.';
  END IF;

  RAISE NOTICE '937 OK — batimento do laço rápido criado em epoch';
END $$;
