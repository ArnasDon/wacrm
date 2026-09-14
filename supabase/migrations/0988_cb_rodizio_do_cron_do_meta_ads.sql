-- ============================================================
-- 988 — o cron do Meta Ads faz rodízio das contas
--
-- Achado do Codex no PR #163 (feito para o cron do tl;dv, que foi copiado
-- deste): `/api/cb/meta-ads/cron` percorre as contas conectadas em ordem
-- de `account_id` e, quando o orçamento de 90 s acaba, adia as restantes —
-- mas o ciclo seguinte reconstrói a lista na MESMA ordem, então sob carga a
-- mesma cauda fica de fora em todo ciclo, sem erro nenhum.
--
-- A cura é um carimbo de TENTATIVA: `sincronizarMetaAds` grava
-- `last_sync_attempt_at` no COMEÇO de toda varredura, dê certo ou errado, e
-- o cron ordena por ele (nunca tentada primeiro). Quem sobrou num ciclo é a
-- mais antiga do próximo e vai para a frente — rodízio sem cursor guardado.
--
-- ⚠️ Não é `last_sync_at`: aquele só é gravado no SUCESSO, e a conta que
-- falha (token recusado, limite) ficaria na frente para sempre, comendo o
-- orçamento das outras a cada ciclo.
--
-- Só uma coluna nova, nula para todas as contas existentes — que é o
-- estado "nunca tentada" e as põe na frente do primeiro ciclo. Nenhuma
-- mudança de GRANT ou policy (a 976 continua valendo). Idempotente.
-- ============================================================

ALTER TABLE cb_meta_ads_config
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;

-- ============================================================
-- Conferência — válida num banco VAZIO (não exige dado).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cb_meta_ads_config'
      AND column_name = 'last_sync_attempt_at'
  ) THEN
    RAISE EXCEPTION '988: cb_meta_ads_config.last_sync_attempt_at ausente — o cron voltaria a deixar a mesma cauda de fora';
  END IF;
  -- A 976 fechou a tabela para o navegador; a coluna nova não pode reabrir nada.
  IF has_table_privilege('authenticated', 'public.cb_meta_ads_config', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_meta_ads_config', 'SELECT') THEN
    RAISE EXCEPTION '988: cb_meta_ads_config voltou a ser legível pelo navegador';
  END IF;
END $$;
