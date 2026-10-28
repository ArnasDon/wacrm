-- ==============================================================================
-- WACRM — SCRIPT DE DIAGNÓSTICO, BACKUP PERSISTENTE, LIMPEZA E ROLLBACK
-- Tabela: ai_suggestions (EXCLUSIVAMENTE CATEGORIA 'followup')
-- Data: 2026-10-27
-- ==============================================================================
--
-- ATENÇÃO: NÃO EXECUTAR EM PRODUÇÃO SEM AUTORIZAÇÃO EXPRESSA.
-- Este script foi preparado para revisão e execução controlada pelo DBA/admin.
--
-- RESULTADO DA SIMULAÇÃO FORENSE:
-- - Total de sugestões 'followup' com status 'pending': 18.694 registros
-- - Conta afetada: 1 ('f8d2ae51-e393-4a74-a432-ddab0610837e' — 100% dos registros)
-- - Contatos distintos afetados: 416 contatos
-- - Registros a PRESERVAR com status 'pending' (o mais recente de cada contato): 416 registros
-- - Registros duplicados a ALTERAR para status 'ignored': 18.278 registros
-- - Registros de OUTRAS categorias ('learning': 384, 'pipeline_move': 6): 0 alterados (100% PRESERVADOS)
--
-- CRITÉRIOS DE PRESERVAÇÃO:
-- 1. Exclusivo para category = 'followup'. Nenhuma outra categoria de sugestão é tocada.
-- 2. Para cada um dos 416 contatos, a sugestão pendente mais recente (ORDER BY created_at DESC LIMIT 1)
--    é PRESERVADA integralmente com status = 'pending'.
-- 3. As 18.278 duplicatas históricas anteriores são marcadas com status = 'ignored' e updated_at = now(),
--    garantindo que nenhuma chave estrangeira (deals, conversas) seja quebrada e preservando o histórico.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ETAPA 1: DIAGNÓSTICO E CONTAGEM PRÉVIA (CATEGORIA FOLLOWUP)
-- ------------------------------------------------------------------------------

-- Contagem total de sugestões pendentes de follow-up:
SELECT
  account_id,
  count(*) AS total_pending_followups,
  count(DISTINCT contact_id) AS unique_contacts_affected,
  min(created_at) AS oldest_followup,
  max(created_at) AS newest_followup
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category = 'followup'
GROUP BY account_id;

-- Confirmação de que outras categorias existem e NÃO serão alteradas:
SELECT
  category,
  count(*) AS pending_other_categories_count
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category <> 'followup'
GROUP BY category;
-- Esperado: learning ~384, pipeline_move ~6.

-- ------------------------------------------------------------------------------
-- ETAPA 2: BACKUP PERSISTENTE (TABELA FÍSICA NO BANCO)
-- ------------------------------------------------------------------------------
-- Criação de tabela permanente contendo os registros originais de follow-up pendentes:

CREATE TABLE IF NOT EXISTS public.ai_suggestions_backup_20261027 AS
SELECT *
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category = 'followup';

-- Confirmação da integridade do backup (deve retornar exatamente 18.694):
SELECT count(*) AS total_backed_up_rows
FROM public.ai_suggestions_backup_20261027;

-- ------------------------------------------------------------------------------
-- ETAPA 3: EXECUÇÃO SEGURA DA LIMPEZA (TRANSAÇÃO ATÔMICA)
-- ------------------------------------------------------------------------------
-- Atualizar para 'ignored' todas as duplicatas pendentes exceto a mais recente por contato:

BEGIN;

WITH duplicates_to_ignore AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY account_id, contact_id
        ORDER BY created_at DESC
      ) AS rn
    FROM public.ai_suggestions
    WHERE status = 'pending'
      AND category = 'followup'
  ) ranked
  WHERE rn > 1
)
UPDATE public.ai_suggestions
SET
  status = 'ignored',
  updated_at = now()
WHERE id IN (SELECT id FROM duplicates_to_ignore)
  AND category = 'followup'
  AND status = 'pending';

-- Verificação dentro da transação:
-- Deve retornar exatamente 416 registros pendentes de follow-up (1 para cada contato único):
SELECT
  account_id,
  count(*) AS remaining_pending_followups,
  count(DISTINCT contact_id) AS distinct_contacts
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category = 'followup'
GROUP BY account_id;

-- Confirmar que nenhuma outra categoria foi alterada:
SELECT
  category,
  count(*) AS untouched_pending_count
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category <> 'followup'
GROUP BY category;

COMMIT;

-- ------------------------------------------------------------------------------
-- ETAPA 4: VERIFICAÇÃO PÓS-LIMPEZA
-- ------------------------------------------------------------------------------

-- Confirmar que nenhum contato possui mais de 1 sugestão pendente de follow-up:
SELECT
  contact_id,
  count(*) AS pending_followups_per_contact
FROM public.ai_suggestions
WHERE status = 'pending'
  AND category = 'followup'
GROUP BY contact_id
HAVING count(*) > 1;
-- O resultado acima deve ser 0 linhas.

-- ------------------------------------------------------------------------------
-- ETAPA 5: PROCEDIMENTO DE ROLLBACK (SE NECESSÁRIO)
-- ------------------------------------------------------------------------------
-- Caso seja necessária qualquer reversão imediata:
/*
BEGIN;

UPDATE public.ai_suggestions s
SET
  status = b.status,
  updated_at = b.updated_at
FROM public.ai_suggestions_backup_20261027 b
WHERE s.id = b.id
  AND s.category = 'followup';

COMMIT;
*/
