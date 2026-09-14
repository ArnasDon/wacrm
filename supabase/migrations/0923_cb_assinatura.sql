-- ============================================================
-- 923 — assinatura do remetente na mensagem
--
-- Duas colunas em `accounts`, no molde da 021 (`default_currency`): coluna
-- simples com NOT NULL DEFAULT, sem tabela nova e sem mexer em RLS — a policy
-- `accounts_update` da 017 já restringe a escrita a admin+.
--
-- ⚠️ NASCE DESLIGADA, e isso é o ponto. Esta é a primeira feature do projeto
-- que muda o TEXTO QUE O CLIENTE RECEBE. Ligada por padrão, o merge mudaria
-- a comunicação do escritório com todo mundo no instante do deploy, sem
-- ninguém decidir. Desligada, o deploy é inerte e o operador liga quando
-- quiser ver.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O interruptor
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS assinatura_ativa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN accounts.assinatura_ativa IS
  'Prefixar as mensagens enviadas com *Nome:* (F1). Nasce desligada: muda o texto que o cliente recebe.';

-- ------------------------------------------------------------
-- 2. O nome que assina o que NÃO foi escrito por gente
-- ------------------------------------------------------------
-- ⚠️ Coluna própria, e não "usa o nome da conta". Automação, fluxo e IA não
-- têm autor humano (P1.5): uma resposta automática de madrugada assinada com
-- o nome de uma pessoa diz ao cliente que aquela pessoa estava trabalhando —
-- e, num escritório de advocacia, que ela leu o caso. O nome do escritório é
-- a única assinatura honesta para eles.
--
-- Nula = não assina mensagem automática, mesmo com o interruptor ligado. É o
-- padrão seguro: melhor sem assinatura do que com o nome errado.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS assinatura_nome_automatica text;

COMMENT ON COLUMN accounts.assinatura_nome_automatica IS
  'Nome que assina mensagem de automacao/fluxo/IA — o do escritorio, nunca o de uma pessoa. Nula = nao assina automatica.';

-- ------------------------------------------------------------
-- 3. Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_ativa_default text;
  v_ativa_notnull boolean;
BEGIN
  SELECT column_default, is_nullable = 'NO'
    INTO v_ativa_default, v_ativa_notnull
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'accounts'
     AND column_name = 'assinatura_ativa';

  IF v_ativa_default IS NULL THEN
    RAISE EXCEPTION '923: assinatura_ativa nao foi criada';
  END IF;
  IF v_ativa_default NOT LIKE '%false%' THEN
    RAISE EXCEPTION '923: assinatura_ativa nao nasceu DESLIGADA (default=%)', v_ativa_default;
  END IF;
  IF NOT v_ativa_notnull THEN
    RAISE EXCEPTION '923: assinatura_ativa deveria ser NOT NULL';
  END IF;

  -- E nenhuma conta existente pode ter sido ligada pela migration.
  IF EXISTS (SELECT 1 FROM accounts WHERE assinatura_ativa) THEN
    RAISE EXCEPTION '923: alguma conta ja nasceu com a assinatura LIGADA';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'accounts'
       AND column_name = 'assinatura_nome_automatica'
  ) THEN
    RAISE EXCEPTION '923: assinatura_nome_automatica nao foi criada';
  END IF;
END $$;
