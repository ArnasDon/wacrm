-- 995_cb_asaas_ciclo_e_etiqueta.sql
--
-- Duas colunas que a revisão do PR #201 pediu (docs/PLANO-integracao-asaas.md,
-- §11 #19), as duas aditivas:
--
-- 1) `cb_asaas_config.sincronizando_desde` — o CADEADO do ciclo. Até aqui a
--    sincronização do Asaas não tinha nenhum: o cron (laço lento), o botão
--    "Sincronizar" do cartão e a primeira sincronização depois de conectar
--    (em `after()`) podiam correr JUNTOS — e no deploy `start-first` há dois
--    processos Node vivos. Dois ciclos concorrentes com `visto_em`
--    diferentes se atropelam na varredura de "cliente que sumiu da
--    listagem": o mais novo marcaria como apagados os clientes que o mais
--    velho acabou de gravar. É o mesmo cadeado do Calendly (980) e do
--    webhook de entrada (982): `UPDATE … WHERE sincronizando_desde IS NULL
--    OR sincronizando_desde < now() - 10 min RETURNING`, cerca de posse nas
--    escritas de fim de ciclo, e recolhimento por idade MAIOR que o teto do
--    ciclo (90 s de orçamento + 20 s de timeout por pedido).
--
-- 2) `cb_asaas_clientes.etiqueta_pendente` — a ficha que o CRM criou (D2)
--    e cuja etiqueta `asaas` NÃO ficou gravada (o upsert de `contact_tags`
--    devolveu erro). A retentativa passa a olhar SÓ estas linhas. Derivar
--    "faltou etiquetar" da ausência em `contact_tags` — a primeira versão —
--    devolvia a etiqueta que uma pessoa tirou de propósito, a cada 15 min.
--
-- Nenhum privilégio muda: as duas tabelas seguem FECHADAS ao navegador (992
-- e 994). Idempotente.

ALTER TABLE cb_asaas_config
  ADD COLUMN IF NOT EXISTS sincronizando_desde timestamptz;

ALTER TABLE cb_asaas_clientes
  ADD COLUMN IF NOT EXISTS etiqueta_pendente boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cb_asaas_config' AND column_name = 'sincronizando_desde'
  ) THEN
    RAISE EXCEPTION '995: cb_asaas_config.sincronizando_desde ausente — o ciclo ficaria sem cadeado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cb_asaas_clientes' AND column_name = 'etiqueta_pendente'
  ) THEN
    RAISE EXCEPTION '995: cb_asaas_clientes.etiqueta_pendente ausente';
  END IF;
  -- As duas continuam fechadas: a coluna nova não abre nada.
  IF has_table_privilege('authenticated', 'public.cb_asaas_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_clientes', 'SELECT') THEN
    RAISE EXCEPTION '995: authenticated alcança as tabelas do Asaas — tudo passa pela rota';
  END IF;
END $$;
