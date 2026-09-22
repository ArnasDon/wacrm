-- ============================================================
-- 1036 — As reuniões históricas da Kommo, só como histórico.
--
-- Decisão 27 do plano da migração (operador, 22/09/2026, opção b): as datas
-- do campo de LEAD "Reunião Marcada" da Kommo vêm para o CB CRM sem tocar no
-- campo "Data e Hora Reunião" — que é do Calendly (valores vivos) e é o que
-- os lembretes de reunião leem — e sem disparar nada. Por isso a tabela é
-- PRÓPRIA e FECHADA ao navegador: nenhuma tela, automação ou lembrete a lê.
-- Quem vai lê-la é o mapa de reuniões por dia e horário (Fase 8 do funil
-- comercial), pelo servidor.
--
--  • Uma linha por LEAD da Kommo. A Kommo guarda só a ÚLTIMA data de cada
--    lead (a remarcada sobrescreve a anterior), então é isso que existe para
--    trazer. `(account_id, kommo_lead_id)` é a chave: rodar de novo no dia do
--    corte atualiza a linha em vez de duplicar.
--  • `contact_id` fica NULO quando a pessoa não está no CRM — o lead PERDIDO
--    que ficou fora do recorte da carga de 21/09. A data fica guardada assim
--    mesmo, com o funil e a etapa da Kommo, para não se perder quando a Kommo
--    sair do ar. Nenhuma ficha nem card nasce disto.
--  • `ligada_por` diz como a ficha foi achada: pelo card da carga
--    (`deals.kommo_lead_id`), pelo campo `kommo_contact_id` ou pelo telefone.
--    Sem CHECK amarrando-a ao `contact_id`: apagar o contato faz SET NULL, e
--    UPDATE revalida CHECK — a exclusão do contato passaria a falhar (912).
--  • Só datas PASSADAS entram; quem filtra é o script (docs/PLANO-migracao-kommo.md).
--  • Desfazer: DELETE por `lote` — nada referencia esta tabela.
-- ============================================================

create unique index if not exists contacts_id_account_idx on public.contacts (id, account_id);

create table if not exists public.cb_reunioes_da_kommo (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  contact_id      uuid,
  kommo_lead_id   bigint not null,
  kommo_funil_id  bigint,
  kommo_etapa_id  bigint,
  reuniao_em      timestamptz not null,
  link            text,
  marcou_onde     text,
  ligada_por      text,
  lote            text not null,
  importado_em    timestamptz not null default now(),
  constraint cb_reunioes_da_kommo_contato_fk
    foreign key (contact_id, account_id) references public.contacts (id, account_id)
    on delete set null (contact_id),
  constraint cb_reunioes_da_kommo_ligada_por_ck
    check (ligada_por is null or ligada_por in ('card', 'contato_kommo', 'telefone')),
  constraint cb_reunioes_da_kommo_lead_uk unique (account_id, kommo_lead_id)
);

comment on table public.cb_reunioes_da_kommo is
  'Reuniões históricas da Kommo (a última data de cada lead), só como histórico. '
  'Fechada ao navegador; nenhum lembrete nem automação a lê. Migration 1036.';

alter table public.cb_reunioes_da_kommo enable row level security;
revoke all on table public.cb_reunioes_da_kommo from public, anon, authenticated;
-- Em banco novo o service_role não herda nada do ambiente (regra 1 da seção
-- de migrations do CLAUDE.md): o que a conferência cobra, esta migration dá.
grant all on table public.cb_reunioes_da_kommo to service_role;

-- ------------------------------------------------------------
-- Conferência. Só afirma AUSÊNCIA e o que esta migration concedeu — nada
-- aqui depende de dado que só existe em produção.
-- ------------------------------------------------------------
do $$
declare
  v_tabela text := 'public.cb_reunioes_da_kommo';
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cb_reunioes_da_kommo'
      and c.relrowsecurity
  ) then
    raise exception '1036: cb_reunioes_da_kommo sem RLS ligada';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cb_reunioes_da_kommo'
  ) then
    raise exception '1036: cb_reunioes_da_kommo ganhou policy — ela é fechada ao navegador';
  end if;

  if has_table_privilege('anon', v_tabela, 'SELECT')
     or has_table_privilege('anon', v_tabela, 'INSERT')
     or has_table_privilege('authenticated', v_tabela, 'SELECT')
     or has_table_privilege('authenticated', v_tabela, 'INSERT')
     or has_table_privilege('authenticated', v_tabela, 'UPDATE')
     or has_table_privilege('authenticated', v_tabela, 'DELETE') then
    raise exception '1036: anon/authenticated alcançam cb_reunioes_da_kommo';
  end if;

  if not has_table_privilege('service_role', v_tabela, 'SELECT')
     or not has_table_privilege('service_role', v_tabela, 'INSERT')
     or not has_table_privilege('service_role', v_tabela, 'UPDATE')
     or not has_table_privilege('service_role', v_tabela, 'DELETE') then
    raise exception '1036: service_role sem acesso a cb_reunioes_da_kommo';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = v_tabela::regclass and conname = 'cb_reunioes_da_kommo_lead_uk'
  ) then
    raise exception '1036: falta a chave única (account_id, kommo_lead_id)';
  end if;

  raise notice '1036: cb_reunioes_da_kommo no lugar, fechada ao navegador.';
end
$$;
