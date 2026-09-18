-- ============================================================
-- 1004 — Índice da fila de automações por EXECUÇÃO (`log_id`).
--
-- A fila `automation_pending_executions` (006) tem índice só pelo vencimento
-- (`run_at`, parcial em `pending`) e pela conta. Toda pergunta "o que mais
-- existe DESTA execução?" varria a tabela inteira:
--
--   * a guarda de `fecharLog` (985) — "sobrou espera VIVA deste log?" — a cada
--     execução que termina;
--   * o sinal `execucaoJaInterrompida` (PR #223, 18/09/2026) — "alguma espera
--     deste log em `cancelled`?" — a cada RETOMADA e a cada ESTACIONAMENTO;
--   * o cancelamento das esperas irmãs por `log_id`, quando o cliente responde.
--
-- Hoje a tabela está VAZIA em produção (medido em 18/09/2026: nenhuma
-- automação ativa tem "Aguardar"). Ela cresce a partir da recuperação de No
-- Show — dez esperas por cliente por execução — e NINGUÉM a poda: `done` e
-- `cancelled` ficam para sempre (é o histórico que o sinal lê). Sem o índice,
-- o agendador ficaria cada vez mais lento a cada tique, sem erro nenhum
-- (Codex, 4ª rodada do PR #223).
--
-- Índice CHEIO em `log_id`, e não parcial em `cancelled`: as três perguntas
-- acima filtram status DIFERENTES (`pending`/`running`, `cancelled`, `pending`)
-- e um índice só as serve todas. `log_id` é nulo em linha sem registro (a FK
-- é opcional); o btree simplesmente não a devolve para quem filtra por valor.
--
-- ⚠️ ADITIVA: nenhum código depende do índice — sem ele, as mesmas consultas
-- respondem certo, só devagar. Pode entrar antes ou depois do deploy.
-- ============================================================

create index if not exists automation_pending_executions_log_id_idx
  on public.automation_pending_executions (log_id);

comment on index public.automation_pending_executions_log_id_idx is
  'As perguntas por EXECUÇÃO: a guarda de fecharLog (espera viva), o sinal de interrupção (espera cancelada) e o cancelamento das irmãs. Sem ele, cada uma varria a fila inteira — que ninguém poda.';

-- ============================================================
-- Conferência — verdade em banco VAZIO: o índice existe. Sem REVOKE, logo sem
-- GRANT a devolver; sem dado exigido.
-- ============================================================

do $$
begin
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_pending_executions'
       and indexname = 'automation_pending_executions_log_id_idx'
  ) then
    raise exception '1004: o índice automation_pending_executions_log_id_idx não foi criado';
  end if;
  raise notice '1004: índice por log_id no lugar.';
end $$;
