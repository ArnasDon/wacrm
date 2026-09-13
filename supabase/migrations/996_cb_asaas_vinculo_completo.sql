-- 996 — Asaas: o marcador de que o VÍNCULO da listagem vigente terminou inteiro.
--
-- `vencidas_listadas_em` é carimbado no passo 4 do ciclo (a listagem das
-- cobranças vencidas está completa no espelho), e o vínculo cliente ↔ contato
-- roda no passo 7. A tela lê o resumo entre os dois, e "ninguém deve" ali é
-- lacuna, não resposta. `last_sync_at` (passo 8) não basta como marcador: o
-- ciclo TERMINA com sucesso mesmo quando ADIOU a criação de fichas (teto de
-- 150 por ciclo, ou o prazo) — e nesse ciclo o mapa contato → dívida ainda
-- não está inteiro (Codex, PR #203, 7ª rodada).
--
-- `vinculo_completo_em` só é carimbado quando o passo 7 não adiou nada; o
-- navegador considera o ciclo completo quando ele é >= `vencidas_listadas_em`
-- (`cicloCompleto`, em `src/lib/asaas/espelho.ts`).
--
-- Aditiva: o app anterior não lê a coluna. Acervo: conta que já completou
-- algum ciclo antes desta coluna existir recebe o `last_sync_at` — era a régua
-- de então, e sem o acervo o filtro "Inadimplentes" ficaria neutralizado até
-- o próximo ciclo em toda instalação que atualizar.

ALTER TABLE public.cb_asaas_config
  ADD COLUMN IF NOT EXISTS vinculo_completo_em timestamptz;

COMMENT ON COLUMN public.cb_asaas_config.vinculo_completo_em IS
  'Início do último ciclo cujo passo de vínculo terminou SEM adiar nada; o ciclo é completo quando >= vencidas_listadas_em.';

UPDATE public.cb_asaas_config
   SET vinculo_completo_em = last_sync_at
 WHERE vinculo_completo_em IS NULL
   AND last_sync_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_asaas_config' AND column_name = 'vinculo_completo_em'
  ) THEN
    RAISE EXCEPTION '996: a coluna vinculo_completo_em não existe';
  END IF;
  -- Nada afirma presença de dado: em banco vazio o acervo é no-op.
  IF EXISTS (
    SELECT 1 FROM public.cb_asaas_config
     WHERE last_sync_at IS NOT NULL AND vinculo_completo_em IS NULL
  ) THEN
    RAISE EXCEPTION '996: o acervo deixou conta com ciclo terminado e sem o marcador';
  END IF;
END $$;
