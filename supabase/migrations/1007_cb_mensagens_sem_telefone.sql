-- ============================================================
-- 1007 — Mensagem 1:1 que chega em `@lid` SEM telefone deixa de ser jogada
-- fora: ou o CRM acha o telefone no próprio acervo, ou a RETÉM até o número
-- aparecer.
--
-- Contexto (19/09/2026, docs/PLANO-lid-sem-telefone.md): quando a Evolution
-- não consegue decifrar uma mensagem de primeira — típico da PRIMEIRA
-- mensagem de um contato novo —, a Baileys 7 pede uma cópia ao celular
-- pareado, e essa cópia chega com a chave só em `@lid` (lacuna da biblioteca:
-- `requestPlaceholderResend` sem o `msgData`). O CRM identifica o cliente
-- pelo telefone e DESCARTAVA a mensagem, com um `console.warn` como único
-- rastro. Medido: 5 em 3.875 mensagens de cliente em 10 dias — 4 eram
-- duplicata de mensagem que também chegou normal; 1 era a fala inicial de um
-- lead novo, que nunca apareceu na conversa.
--
-- Duas peças:
--
--   cb_mensagens_sem_telefone
--     o registro DURÁVEL de cada ocorrência (o log do contêiner some quando o
--     Swarm recicla a tarefa). `retida` guarda o payload cru até o telefone
--     aparecer; ao entregar, o payload é APAGADO — o conteúdo já está em
--     `messages`, e guardar duas cópias de fala de cliente não compra nada.
--     FECHADA ao navegador: sem policy, sem GRANT a `authenticated`. A tela
--     (bloco de correções do Meu dia) lê por rota, e só contagens.
--
--   cb_assentar_mensagem_historica(conversa, conta_nao_lida)
--     o que a conversa precisa DEPOIS de receber uma mensagem com carimbo
--     ANTIGO. O gatilho da 972 conta por ordem de INSERÇÃO: a fala de 13:03
--     gravada às 13:05, depois da resposta de 13:04, acenderia "em atraso há
--     2 min" sobre cliente já respondido (e um eco antigo do escritório
--     APAGARIA um atraso verdadeiro). A função refaz `aguardando_desde` pela
--     fórmula canônica — a MESMA do gatilho de mensagem apagada da 972 —,
--     soma a não lida quando pedida e toca `updated_at`, que é o que faz o
--     realtime corrigir a lista de quem está com a caixa de entrada aberta.
--
-- Aditiva: nada em produção lê a tabela nem chama a função até o deploy.
-- O código tolera a ausência das duas (cai no descarte de sempre), mas a
-- ordem continua sendo migration ANTES do merge.
-- ============================================================

-- ------------------------------------------------------------
-- 1) O registro das ocorrências.
-- ------------------------------------------------------------
create table if not exists public.cb_mensagens_sem_telefone (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  -- A conexão por onde a mensagem CHEGOU. É por ela que o anexo de uma
  -- retida é baixado ao religar — que pode acontecer por outra conexão (o
  -- LID é do usuário do WhatsApp, não do par com o nosso número).
  channel_id          uuid,
  lid_jid             text not null,
  -- O id da mensagem no WhatsApp (`key.id`) — o mesmo de `messages.message_id`.
  provider_message_id text not null,
  from_me             boolean not null default false,
  -- O tipo de conteúdo (text, image, audio…): só para o aviso dizer o que é.
  tipo                text,
  -- O carimbo do WhatsApp. Religar grava a mensagem com ELE, não com now().
  carimbo             timestamptz not null,
  -- O item cru do webhook. Existe se, e somente se, a linha está `retida`.
  payload             jsonb,
  situacao            text not null default 'retida',
  resolvida_por       text,
  message_id          uuid references public.messages(id) on delete set null,
  recebida_em         timestamptz not null default now(),
  resolvida_em        timestamptz,

  constraint cb_mensagens_sem_telefone_situacao_ck
    check (situacao in ('retida', 'entregue', 'duplicada')),
  constraint cb_mensagens_sem_telefone_resolvida_por_ck
    check (resolvida_por is null or resolvida_por in ('acervo', 'religacao')),
  -- O payload é conteúdo de cliente: existe só enquanto é necessário.
  constraint cb_mensagens_sem_telefone_payload_ck
    check ((situacao = 'retida') = (payload is not null)),
  constraint cb_mensagens_sem_telefone_lid_ck
    check (lid_jid like '%@lid'),
  -- A Evolution REENTREGA o webhook quando não recebe 200 a tempo: a segunda
  -- cópia não pode virar segunda linha. Índice TOTAL (não parcial) para
  -- servir de alvo ao ON CONFLICT do PostgREST — a lição da 903.
  constraint cb_mensagens_sem_telefone_mensagem_uk
    unique (account_id, provider_message_id),
  -- FK COMPOSTA, na forma da 903/908: a ingestão roda em service-role e
  -- ignora RLS, e FK simples só garantiria "existe uma conexão com esse id".
  -- ⚠️ SET NULL com a coluna NOMEADA (PG 15+): `account_id` é NOT NULL, e o
  -- SET NULL sem lista tentaria zerar as duas — apagar uma conexão passaria
  -- a estourar violação (a lição da 966).
  constraint cb_mensagens_sem_telefone_canal_fk
    foreign key (channel_id, account_id)
    references public.cb_channels (id, account_id)
    on delete set null (channel_id)
);

comment on table public.cb_mensagens_sem_telefone is
  'Mensagens 1:1 da Evolution que chegaram em @lid sem telefone (1007). retida = aguardando o numero aparecer, com o payload cru; entregue = gravada em messages (pelo acervo, na chegada, ou por religacao); duplicada = a mesma mensagem ja tinha entrado pela via normal. Fechada ao navegador.';

-- A pergunta do caminho quente: "há retida deste LID?" — feita depois de
-- CADA mensagem 1:1 gravada. Parcial: a tabela guarda o histórico inteiro,
-- mas só as `retida` interessam, e elas são um punhado.
create index if not exists cb_mensagens_sem_telefone_retidas_idx
  on public.cb_mensagens_sem_telefone (account_id, lid_jid)
  where situacao = 'retida';

alter table public.cb_mensagens_sem_telefone enable row level security;
-- As DUAS metades, sempre (a lição da 913/915): PUBLIC e os papéis.
revoke all on table public.cb_mensagens_sem_telefone from public, anon, authenticated;
-- O privilégio herdado do Supabase não existe em banco novo: o que a
-- conferência lá embaixo cobra, esta linha concede.
grant all on table public.cb_mensagens_sem_telefone to service_role;

-- ------------------------------------------------------------
-- 2) A conversa depois de uma mensagem HISTÓRICA.
--
-- SECURITY INVOKER: quem chama é a ingestão (service_role), que já escreve
-- em `conversations` e lê `messages`. UMA instrução — o recálculo enxerga um
-- retrato só do banco.
--
-- ⚠️ A fórmula de `aguardando_desde` é CÓPIA da que o gatilho
-- `cb_mensagem_apagada_recalcula_espera` (972) roda: a primeira mensagem viva
-- do cliente depois da última resposta viva de GENTE (`sender_id` OU
-- `from_device` — a régua do Radar). Mudou lá, muda aqui; há teste lendo os
-- dois SQLs. Grupo e conversa encerrada ficam NULOS — as duas invariantes
-- que a própria 972 confere.
-- ------------------------------------------------------------
create or replace function public.cb_assentar_mensagem_historica(
  p_conversation_id uuid,
  p_conta_nao_lida  boolean
)
returns void
language sql
security invoker
set search_path = public
as $$
  update conversations c
  set unread_count = coalesce(c.unread_count, 0)
        + case when p_conta_nao_lida then 1 else 0 end,
      aguardando_desde = case
        when c.group_id is not null or c.status = 'closed' then null
        else (
          select min(m.created_at)
          from messages m
          where m.conversation_id = c.id
            and m.sender_type = 'customer'
            and m.deleted_at is null
            and m.created_at > coalesce((
              select max(h.created_at)
              from messages h
              where h.conversation_id = c.id
                and h.sender_type = 'agent'
                and (h.sender_id is not null or h.from_device)
                and h.deleted_at is null
            ), '-infinity'::timestamptz)
        )
      end,
      updated_at = now()
  where c.id = p_conversation_id;
$$;

comment on function public.cb_assentar_mensagem_historica(uuid, boolean) is
  'Depois de gravar uma mensagem com carimbo ANTIGO (1007): refaz aguardando_desde pela formula canonica da 972, soma a nao lida quando pedida e toca updated_at. So service_role.';

revoke execute on function public.cb_assentar_mensagem_historica(uuid, boolean)
  from public, anon, authenticated;
-- Em Postgres o EXECUTE nasce concedido a PUBLIC: o REVOKE acima o tira de
-- quem chama também — daí o GRANT de volta (no-op em produção, idempotente).
grant execute on function public.cb_assentar_mensagem_historica(uuid, boolean)
  to service_role;

-- ------------------------------------------------------------
-- 3) Conferência. Só afirma AUSÊNCIA e o que esta migration concedeu —
--    nada aqui depende de dado que só existe em produção.
-- ------------------------------------------------------------
do $$
declare
  v_tabela     text := 'public.cb_mensagens_sem_telefone';
  v_assinatura text := 'public.cb_assentar_mensagem_historica(uuid, boolean)';
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cb_mensagens_sem_telefone'
      and c.relrowsecurity
  ) then
    raise exception '1007: cb_mensagens_sem_telefone sem RLS ligada';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cb_mensagens_sem_telefone'
  ) then
    raise exception '1007: cb_mensagens_sem_telefone ganhou policy — ela é fechada ao navegador';
  end if;

  if has_table_privilege('anon', v_tabela, 'SELECT')
     or has_table_privilege('anon', v_tabela, 'INSERT')
     or has_table_privilege('authenticated', v_tabela, 'SELECT')
     or has_table_privilege('authenticated', v_tabela, 'INSERT')
     or has_table_privilege('authenticated', v_tabela, 'UPDATE')
     or has_table_privilege('authenticated', v_tabela, 'DELETE') then
    raise exception '1007: anon/authenticated alcançam cb_mensagens_sem_telefone';
  end if;
  if not has_table_privilege('service_role', v_tabela, 'SELECT')
     or not has_table_privilege('service_role', v_tabela, 'INSERT')
     or not has_table_privilege('service_role', v_tabela, 'UPDATE') then
    raise exception '1007: service_role sem acesso a cb_mensagens_sem_telefone';
  end if;

  if has_function_privilege('anon', v_assinatura, 'EXECUTE')
     or has_function_privilege('authenticated', v_assinatura, 'EXECUTE') then
    raise exception '1007: anon/authenticated ainda executam cb_assentar_mensagem_historica';
  end if;
  if not has_function_privilege('service_role', v_assinatura, 'EXECUTE') then
    raise exception '1007: service_role perdeu o EXECUTE de cb_assentar_mensagem_historica';
  end if;

  raise notice '1007: cb_mensagens_sem_telefone e cb_assentar_mensagem_historica no lugar.';
end $$;
