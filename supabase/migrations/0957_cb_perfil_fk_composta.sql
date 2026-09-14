-- ============================================================
-- 957 — a FK de `profiles.perfil_id` passa a ser COMPOSTA
--
-- Correção de revisão sobre a 956, encontrada antes de qualquer código
-- consumir a coluna. Migration nova (e não edição da 956) porque a 956 JÁ
-- ESTÁ APLICADA em produção: editar o arquivo faria o replay do CI criar uma
-- estrutura que produção não tem, que é a definição de drift.
--
-- O que estava errado
-- -------------------
-- A 956 escreveu `perfil_id UUID REFERENCES cb_perfis_de_acesso(id)`. FK
-- simples só garante "existe uma linha com esse id" — NÃO garante que a linha
-- é da MESMA CONTA.
--
-- Isso importa porque as rotas de escrita rodam em SERVICE-ROLE e ignoram RLS
-- (é assim que a rota de perfis da Fase 5 vai funcionar). Um bug de escopo
-- ali — `.eq('account_id', …)` esquecido num lookup, exatamente o engano que o
-- CLAUDE.md registra para as rotas v1 — conseguiria carimbar em alguém o
-- perfil de OUTRA conta, e o banco aceitaria em silêncio.
--
-- O estrago seria discreto: a RLS de leitura barraria o perfil forasteiro, o
-- hook receberia vazio, e `perfil = null` significa SEM RESTRIÇÃO. Ou seja, a
-- pessoa passaria a ver tudo — falhando para o lado errado, sem erro nenhum na
-- tela nem no log.
--
-- É a mesma classe de proteção que a 908 já deu a `deals` e a `cb_channels`
-- (`(pipeline_id, account_id)`, `(channel_id, account_id)`); a 956 simplesmente
-- ficou fora do padrão.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O alvo que a FK composta precisa
-- ------------------------------------------------------------
-- `id` já é PK (portanto único sozinho); este índice existe só para servir de
-- alvo da referência composta, como `pipelines (id, account_id)` na 908.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_perfis_id_conta
  ON cb_perfis_de_acesso (id, account_id);

-- ------------------------------------------------------------
-- 2. Troca a FK simples pela composta
-- ------------------------------------------------------------
-- ⚠️ `ON DELETE SET NULL (perfil_id)` — a coluna nomeada é obrigatória numa FK
-- composta, e é o ponto todo: apagar um perfil zera SÓ o vínculo, nunca o
-- `account_id` da pessoa. Sem nomear a coluna, o Postgres zeraria as duas e o
-- membro perderia a conta inteira.
--
-- ⚠️ E o SET NULL continua sendo o comportamento certo por outro motivo, já
-- registrado na 956: `perfil_id` nulo significa SEM RESTRIÇÃO, então apagar um
-- perfil devolve acesso em vez de trancar a equipe dele para fora. A tela da
-- Fase 5 é quem tem de avisar disso ao apagar — ver a nota no plano.
DO $$
BEGIN
  -- O nome sai do próprio catálogo: a 956 deixou o Postgres nomear a
  -- constraint, e o nome gerado não é contrato.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'profiles'
      AND c.contype = 'f'
      AND c.confrelid = 'cb_perfis_de_acesso'::regclass
      AND array_length(c.conkey, 1) = 1
  ) THEN
    EXECUTE (
      SELECT format('ALTER TABLE profiles DROP CONSTRAINT %I', c.conname)
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'profiles'
        AND c.contype = 'f'
        AND c.confrelid = 'cb_perfis_de_acesso'::regclass
        AND array_length(c.conkey, 1) = 1
      LIMIT 1
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_perfil_conta_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_perfil_conta_fkey
      FOREIGN KEY (perfil_id, account_id)
      REFERENCES cb_perfis_de_acesso (id, account_id)
      ON DELETE SET NULL (perfil_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Conferência
-- ------------------------------------------------------------
-- ⚠️ Asserções de ESTRUTURA e de AUSÊNCIA. A prova de comportamento deriva o
-- dado do banco e PULA quando não houver — num banco vazio (o replay do CI)
-- não há duas contas para cruzar, e exigir que houvesse faria a migration
-- reprovar por falta de dado em vez de por defeito.
DO $$
DECLARE
  v_conta_a UUID;
  v_conta_b UUID;
  v_perfil  UUID;
  v_user    UUID;
  v_ok      BOOLEAN := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_perfil_conta_fkey'
  ) THEN
    RAISE EXCEPTION '957: a FK composta não foi criada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'profiles'
      AND c.contype = 'f'
      AND c.confrelid = 'cb_perfis_de_acesso'::regclass
      AND array_length(c.conkey, 1) = 1
  ) THEN
    RAISE EXCEPTION '957: a FK simples da 956 continua lá — as duas juntas não somam proteção, a simples só volta a aceitar perfil de outra conta';
  END IF;

  -- `perfil_id` tem de seguir aceitando NULL: é o estado de todo mundo hoje.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'perfil_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '957: perfil_id virou NOT NULL';
  END IF;

  -- Prova de comportamento: perfil de OUTRA conta tem de ser recusado.
  SELECT p.account_id, p.user_id INTO v_conta_a, v_user
  FROM profiles p
  WHERE p.account_id IS NOT NULL
  LIMIT 1;

  SELECT a.id INTO v_conta_b
  FROM accounts a
  WHERE a.id IS DISTINCT FROM v_conta_a
  LIMIT 1;

  IF v_conta_a IS NULL OR v_conta_b IS NULL THEN
    RAISE NOTICE '957: banco sem duas contas, pulando a prova de cruzamento.';
  ELSE
    -- Um perfil que pertence à conta B...
    INSERT INTO cb_perfis_de_acesso (account_id, nome, papel_base)
    VALUES (v_conta_b, '__957_prova_cruzada__', 'agent')
    RETURNING id INTO v_perfil;

    -- ...não pode ser carimbado em alguém da conta A.
    BEGIN
      UPDATE profiles SET perfil_id = v_perfil WHERE user_id = v_user;
      UPDATE profiles SET perfil_id = NULL WHERE user_id = v_user;  -- desfaz
    EXCEPTION
      WHEN foreign_key_violation THEN v_ok := true;
    END;

    DELETE FROM cb_perfis_de_acesso WHERE id = v_perfil;

    IF NOT v_ok THEN
      RAISE EXCEPTION '957: a FK aceitou perfil de outra conta — a proteção não pegou';
    END IF;
  END IF;
END $$;
