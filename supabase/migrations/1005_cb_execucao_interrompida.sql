-- ============================================================
-- 1005 — A execução de automação INTERROMPIDA tem marca durável no registro,
-- e a espera é estacionada por uma função que respeita essa marca.
--
-- Contexto (PR #223, 18/09/2026): duas opções novas param uma sequência por
-- conta própria — a resposta do cliente ("Aguardar — parar se o cliente
-- responder") e a saída do card da etapa ("interromper se o card sair"). Os
-- cancelamentos que já existiam (botão Parar, passo "Parar automação",
-- desativação) e os dois novos mexem SÓ nas linhas da fila
-- `automation_pending_executions` — e a fila não conhece a execução que
-- está RODANDO: entre o disparo e a primeira espera não há linha nenhuma.
-- Cinco rodadas de revisão caçaram o mesmo furo por ângulos diferentes: a
-- espera irmã estacionada DEPOIS do cancelamento (o escopo de fora ainda
-- rodando), a retentativa que entra na fila em seguida, a saída da etapa
-- num instante sem espera, e o vão entre "perguntar se foi interrompida" e
-- "inserir". Em todos, se o card voltasse à etapa a execução antiga
-- acordava ao lado da nova — a sequência em dobro para o cliente.
--
-- A resposta é UMA fonte da verdade, no registro da execução, que existe
-- desde o primeiro passo:
--
--   automation_logs.interrompida_em / interrompida_por
--     gravados por TODO cancelamento (resposta, etapa, parar, passo,
--     desativacao) — só a primeira marca fica;
--
--   cb_estacionar_espera(...)
--     a ÚNICA porta de entrada da fila pelo motor: trava a linha do registro
--     (FOR UPDATE), confere a marca e só então insere, numa transação só.
--     Devolve o id da espera, ou NULL quando a execução já foi interrompida.
--     Quem marca (UPDATE na mesma linha) e quem estaciona se serializam pelo
--     lock da linha — o vão fechou.
--
-- ⚠️ ORDEM DE DEPLOY: o motor passa a chamar a função em TODO "Aguardar" e em
-- toda retentativa. Sem ela, o passo falha de forma VISÍVEL ("não consegui
-- agendar a espera: function ... does not exist") — nada sai errado ao
-- cliente, mas nenhuma sequência estaciona. Aplicar ANTES do deploy.
-- ============================================================

alter table public.automation_logs
  add column if not exists interrompida_em timestamptz,
  add column if not exists interrompida_por text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'automation_logs_interrompida_por_check'
       and conrelid = 'public.automation_logs'::regclass
  ) then
    alter table public.automation_logs
      add constraint automation_logs_interrompida_por_check
      check (interrompida_por in ('resposta', 'etapa', 'parar', 'passo', 'desativacao'));
  end if;
end $$;

comment on column public.automation_logs.interrompida_em is
  'Instante em que a execução foi interrompida por um cancelamento (resposta do cliente, saída da etapa, botão Parar, passo "Parar automação", desativação). Só a primeira marca fica. A retomada e cb_estacionar_espera recusam execução marcada.';
comment on column public.automation_logs.interrompida_por is
  'O motivo da interrupção: resposta | etapa | parar | passo | desativacao (vocabulário de src/lib/automations/interrupcao.ts).';

-- A pergunta da saída da etapa: "execuções VIVAS deste contato". Parcial em
-- quem ainda não terminou — a maioria das linhas tem fim.
create index if not exists automation_logs_vivas_por_contato_idx
  on public.automation_logs (account_id, contact_id)
  where finalizado_em is null and interrompida_em is null;

-- ------------------------------------------------------------
-- A porta da fila. SECURITY INVOKER: quem chama é o motor (service_role),
-- que já escreve na fila; ninguém logado tem EXECUTE (a fila é service-role
-- only desde a 006, e `authenticated` não tem sequer SELECT nela).
-- `#variable_conflict use_variable`: os parâmetros têm o nome das colunas,
-- de propósito, para o motor mandar o MESMO objeto que mandava ao INSERT.
-- ------------------------------------------------------------
create or replace function public.cb_estacionar_espera(
  automation_id uuid,
  account_id uuid,
  user_id uuid,
  contact_id uuid,
  log_id uuid,
  parent_step_id uuid,
  branch text,
  next_step_position integer,
  context jsonb,
  run_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_id uuid;
begin
  if log_id is not null then
    -- Trava a linha do registro: um cancelamento em curso na mesma linha
    -- espera aqui, e o que vier depois vê a marca. Registro apagado no meio
    -- (FK da fila em CASCADE) = nada a estacionar.
    perform 1 from public.automation_logs l where l.id = log_id for update;
    if not found then
      return null;
    end if;
    if exists (
      select 1 from public.automation_logs l
       where l.id = log_id and l.interrompida_em is not null
    ) then
      return null;
    end if;
  end if;

  insert into public.automation_pending_executions
    (automation_id, account_id, user_id, contact_id, log_id, parent_step_id,
     branch, next_step_position, context, run_at, status)
  values
    (automation_id, account_id, user_id, contact_id, log_id, parent_step_id,
     branch, next_step_position, coalesce(context, '{}'::jsonb), run_at, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

-- ⚠️ As DUAS metades, sempre (ver CLAUDE.md, "Fechar EXECUTE de função"):
-- o EXECUTE de função nasce em PUBLIC, e `FROM anon, authenticated` sozinho
-- não tira nada; `FROM PUBLIC` sozinho tira do service_role também, que é
-- quem chama — daí o GRANT de volta (no-op em produção, idempotente).
revoke execute on function public.cb_estacionar_espera(uuid, uuid, uuid, uuid, uuid, uuid, text, integer, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cb_estacionar_espera(uuid, uuid, uuid, uuid, uuid, uuid, text, integer, jsonb, timestamptz)
  to service_role;

-- ============================================================
-- Conferência — só o que é verdade em banco VAZIO.
-- ============================================================
do $$
declare
  v_assinatura text :=
    'public.cb_estacionar_espera(uuid, uuid, uuid, uuid, uuid, uuid, text, integer, jsonb, timestamptz)';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'automation_logs'
       and column_name in ('interrompida_em', 'interrompida_por')
    having count(*) = 2
  ) then
    raise exception '1005: as colunas interrompida_em/interrompida_por não existem';
  end if;

  if has_function_privilege('anon', v_assinatura, 'EXECUTE')
     or has_function_privilege('authenticated', v_assinatura, 'EXECUTE') then
    raise exception '1005: anon/authenticated ainda executam cb_estacionar_espera';
  end if;
  if not has_function_privilege('service_role', v_assinatura, 'EXECUTE') then
    raise exception '1005: service_role perdeu o EXECUTE de cb_estacionar_espera';
  end if;

  raise notice '1005: marca de interrupção e cb_estacionar_espera no lugar.';
end $$;
