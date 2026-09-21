-- ============================================================
-- Migração Kommo → CB CRM: a chave que torna a carga REEXECUTÁVEL.
--
-- A decisão 16 do operador pôs o id do CONTATO da Kommo num campo
-- personalizado, e isso resolve o lado do contato. Não resolve o lado do
-- NEGÓCIO: campo personalizado só existe em contato, e uma pessoa pode ter
-- mais de um card (um por área — Trabalhista × Bancário). O plano mandava
-- guardar o id do lead em `cb_lead_events.details->>'kommo_lead_id'`, e o teste
-- de esforço de 20/09 mediu o preço disso: a pergunta "já migrei este lead?"
-- vira 12.389 varreduras completas sobre uma tabela que vai a ~62.000 linhas —
-- inviável por tempo. E, sem restrição única, quem pular a pergunta duplica
-- 28.316 eventos em silêncio.
--
-- Com a coluna, a idempotência é GARANTIDA PELO BANCO em vez de conferida pelo
-- script: a segunda passada da carga (a do dia do corte, para o delta) colide
-- em 23505 em vez de duplicar. É a diferença entre uma carga que se pode
-- repetir e uma que só se pode rodar uma vez.
--
-- `details->>'kommo_lead_id'` CONTINUA sendo gravado nos eventos, por outro
-- motivo: os 76 leads abertos que se fundem no card sobrevivente têm id
-- próprio, diferente do card, e é só no evento que essa procedência sobrevive.
--
-- Aditiva: nada em produção lê a coluna até a carga existir.
-- ============================================================

alter table public.deals
  add column if not exists kommo_lead_id bigint;

comment on column public.deals.kommo_lead_id is
  'Id do lead na Kommo, para a carga de migração ser reexecutável. Nulo em '
  'todo negócio nascido aqui.';

-- Único por CONTA, não global: o id é da Kommo daquele escritório, e duas
-- contas deste CRM podem importar de Kommos diferentes com ids que colidem.
-- PARCIAL porque a esmagadora maioria dos negócios nasce aqui e fica com a
-- coluna nula — índice total obrigaria todo insert a pagar por uma chave que
-- não existe.
create unique index if not exists deals_kommo_lead_id_idx
  on public.deals (account_id, kommo_lead_id)
  where kommo_lead_id is not null;

-- ------------------------------------------------------------
-- Conferência. Roda como DONO, então não prova privilégio de papel — prova
-- forma. Escrita para passar num banco VAZIO: afirma ausência, nunca presença
-- (ver "Migration tem de aplicar num banco VAZIO" no CLAUDE.md).
-- ------------------------------------------------------------
do $$
declare
  v_tipo text;
  v_indice text;
begin
  select data_type into v_tipo
    from information_schema.columns
   where table_schema = 'public' and table_name = 'deals'
     and column_name = 'kommo_lead_id';

  if v_tipo is distinct from 'bigint' then
    raise exception '1012: deals.kommo_lead_id deveria ser bigint, é %', coalesce(v_tipo, '(ausente)');
  end if;

  select pg_get_indexdef(i.indexrelid) into v_indice
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'deals_kommo_lead_id_idx';

  if v_indice is null then
    raise exception '1012: o índice deals_kommo_lead_id_idx não foi criado';
  end if;

  -- As três metades que importam, lidas da definição renderizada: sem UNIQUE a
  -- carga duplica; sem account_id ela colide entre contas; sem o WHERE o
  -- índice deixa de ser parcial e todo negócio novo passa a pagar por ele.
  if v_indice not like '%UNIQUE%' then
    raise exception '1012: o índice precisa ser UNIQUE — é ele que garante a idempotência. Definição: %', v_indice;
  end if;
  if v_indice not like '%account_id%' then
    raise exception '1012: o índice precisa incluir account_id. Definição: %', v_indice;
  end if;
  if v_indice not like '%WHERE%' then
    raise exception '1012: o índice precisa ser PARCIAL (WHERE kommo_lead_id IS NOT NULL). Definição: %', v_indice;
  end if;

  raise notice '1012: coluna e índice conferidos.';
end $$;
