-- 996 — Asaas: o marcador de que o VÍNCULO da listagem vigente terminou inteiro.
--
-- `vencidas_listadas_em` é carimbado no passo 4 do ciclo (a listagem das
-- cobranças vencidas está completa no espelho), e o vínculo cliente ↔ contato
-- roda no passo 7. A tela lê o resumo entre os dois, e "ninguém deve" ali é
-- lacuna, não resposta (Codex, PR #203, 5ª a 7ª rodadas).
--
-- `vinculo_completo_em` é carimbado no passo 8 (o vínculo desta listagem já
-- rodou); o navegador considera o ciclo completo quando ele é
-- >= `vencidas_listadas_em` (`cicloCompleto`, em `src/lib/asaas/espelho.ts`).
-- Hoje ele coincide com `last_sync_at` — a coluna existe para o marcador ter
-- nome e sobreviver a um dia em que o fim do ciclo e o fim do vínculo se
-- separem. A criação de ficha ADIADA (teto por ciclo, prazo) não o segura:
-- cliente sem ficha não tem conversa a esconder, e segurá-lo neutralizava o
-- filtro da conta inteira durante uma importação (revisão independente).
--
-- Aditiva: o app anterior não lê a coluna. Acervo: conta que já completou
-- algum ciclo antes desta coluna existir recebe o `last_sync_at` — é o mesmo
-- instante que o passo 8 passaria a gravar.

ALTER TABLE public.cb_asaas_config
  ADD COLUMN IF NOT EXISTS vinculo_completo_em timestamptz;

COMMENT ON COLUMN public.cb_asaas_config.vinculo_completo_em IS
  'Início do último ciclo cujo passo de vínculo já rodou; o ciclo é completo quando >= vencidas_listadas_em.';

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
