-- ============================================================
-- 1018 — Encerrar TODAS as conversas abertas, de uma vez, e poder voltar.
--
-- Pedido do operador em 21/09/2026, depois da carga da Kommo: zerar a caixa
-- de entrada. São 889 conversas abertas (nenhuma `pending`), 596 delas com
-- mensagem não lida.
--
-- ⚠️ Por que uma FUNÇÃO e não um UPDATE solto: o que se apaga aqui não se
-- deduz de volta. `assigned_agent_id` diz quem era responsável,
-- `aguardando_desde` é o relógio do alerta de atraso, e `unread_count` é a
-- única marca de que alguém ainda não leu o cliente. Sem a foto do ANTES,
-- "encerrar tudo" é irreversível — e a foto tem de ser gravada na MESMA
-- transação do UPDATE, senão uma falha no meio deixa metade encerrada e sem
-- registro.
--
-- ⚠️⚠️ A FOTO NÃO VAI PARA `public`. `CREATE TABLE` ali herda a concessão
-- padrão do Supabase para anon/authenticated e nasce SEM RLS — esta tabela
-- guarda id de conversa e de responsável da conta inteira. É a mesma regra do
-- livro-razão da 1014, e o mesmo buraco que a 901/906/912 abriram e a 931
-- fechou.
--
-- ⚠️⚠️ GRUPO FICA DE FORA POR PADRÃO, e não é conservadorismo — é um caminho
-- que NÃO EXISTE no código. `reopenClosedConversation` tem seis chamadores
-- (webhook da Meta, os dois da Evolution, o envio, o Instagram e a mensagem
-- tardia da 1010) e `src/lib/cb-groups/persist.ts` NÃO é um deles: aquele
-- arquivo não menciona `conversations.status` em lugar nenhum. Ou seja: a
-- conversa de grupo encerrada NÃO reabre quando alguém escreve no grupo — ela
-- só volta se a EQUIPE mandar mensagem por aqui (o `sendMessageToConversation`
-- reabre). Encerrar um grupo de trabalho vivo é esconder a conversa dele da
-- caixa por tempo indeterminado. Medido em 21/09: os 7 grupos abertos desta
-- conta têm mensagem de 2 a 12 dias atrás e 261 não lidas somadas.
-- Quem quiser incluí-los passa `p_incluir_grupos => true`, por escrito.
--
-- ⚠️ O que NÃO precisa ser tratado aqui, e foi conferido no catálogo:
--   · `cb_encerrar_limpa_espera` (BEFORE UPDATE) zera `aguardando_desde`
--     sozinho na transição para 'closed' — é o comportamento desejado, e a
--     foto guarda o valor para o desfazer.
--   · `notify_conversation_assigned` sai cedo quando o novo responsável é
--     NULO, então soltar 889 responsáveis NÃO gera 889 notificações.
-- ============================================================

create schema if not exists migracao_kommo;
revoke all on schema migracao_kommo from public;
revoke all on schema migracao_kommo from anon, authenticated;
grant usage on schema migracao_kommo to service_role;

create table if not exists migracao_kommo.conversas_antes_do_encerramento (
  conversation_id   uuid primary key,
  account_id        uuid not null,
  status            text not null,
  assigned_agent_id uuid,
  aguardando_desde  timestamptz,
  unread_count      integer,
  era_grupo         boolean not null,
  encerrado_em      timestamptz not null default now()
);

revoke all on table migracao_kommo.conversas_antes_do_encerramento from public;
revoke all on table migracao_kommo.conversas_antes_do_encerramento from anon, authenticated;
grant all  on table migracao_kommo.conversas_antes_do_encerramento to service_role;

create index if not exists conversas_antes_conta_idx
  on migracao_kommo.conversas_antes_do_encerramento (account_id);

-- ------------------------------------------------------------
-- Encerrar.
-- ------------------------------------------------------------
create or replace function public.cb_encerrar_conversas_abertas(
  p_account_id     uuid,
  p_incluir_grupos boolean default false,
  p_conferir       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $encerrar$
declare
  v_alvo      int;
  v_grupos    int;
  v_naolidas  int;
  v_donos     int;
  v_fechadas  int := 0;
  v_fotos     int := 0;
  v_inicio    timestamptz := clock_timestamp();
begin
  if p_account_id is null then
    raise exception 'cb_encerrar_conversas_abertas: p_account_id é obrigatório';
  end if;
  if not exists (select 1 from accounts where id = p_account_id) then
    raise exception 'cb_encerrar_conversas_abertas: conta % não existe', p_account_id;
  end if;

  select count(*),
         count(*) filter (where group_id is not null),
         count(*) filter (where unread_count > 0),
         count(*) filter (where assigned_agent_id is not null)
    into v_alvo, v_grupos, v_naolidas, v_donos
    from conversations
   where account_id = p_account_id
     and status <> 'closed'
     and (p_incluir_grupos or group_id is null);

  if p_conferir then
    return jsonb_build_object(
      'a_encerrar', v_alvo, 'de_grupo', v_grupos,
      'com_nao_lidas', v_naolidas, 'com_responsavel', v_donos,
      'escreveu', false,
      'ms', extract(milliseconds from clock_timestamp() - v_inicio));
  end if;

  -- ⚠️ A foto ANTES do UPDATE e na MESMA transação. `on conflict do nothing`
  -- preserva a PRIMEIRA foto: se o operador rodar de novo depois de alguns
  -- clientes reabrirem conversas, o desfazer continua devolvendo o estado
  -- original, não um intermediário.
  insert into migracao_kommo.conversas_antes_do_encerramento
         (conversation_id, account_id, status, assigned_agent_id,
          aguardando_desde, unread_count, era_grupo)
  select v.id, v.account_id, v.status, v.assigned_agent_id,
         v.aguardando_desde, v.unread_count, (v.group_id is not null)
    from conversations v
   where v.account_id = p_account_id
     and v.status <> 'closed'
     and (p_incluir_grupos or v.group_id is null)
  on conflict (conversation_id) do nothing;
  get diagnostics v_fotos = row_count;

  update conversations v
     set status            = 'closed',
         -- Regra do operador de 02/09/2026, a mesma de `patchDeSituacao`:
         -- encerrar SOLTA o responsável.
         assigned_agent_id = null,
         -- Decisão do operador em 21/09: zerar as não lidas junto. O
         -- distintivo do menu (`use-total-unread.ts`) conta QUALQUER conversa
         -- com não lidas, sem olhar a situação — sem zerar, o menu ficaria
         -- apontando 596 mensagens que ninguém consegue ver na aba Abertas.
         unread_count      = 0
   where v.account_id = p_account_id
     and v.status <> 'closed'
     and (p_incluir_grupos or v.group_id is null);
  get diagnostics v_fechadas = row_count;

  return jsonb_build_object(
    'encerradas',      v_fechadas,
    'fotografadas',    v_fotos,
    'de_grupo',        v_grupos,
    'nao_lidas_zeradas', v_naolidas,
    'responsaveis_soltos', v_donos,
    'ms',              extract(milliseconds from clock_timestamp() - v_inicio));
end;
$encerrar$;

-- ------------------------------------------------------------
-- Desfazer.
-- ------------------------------------------------------------
create or replace function public.cb_desfazer_encerramento_em_lote(
  p_account_id uuid,
  p_conferir   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $desfazer$
declare
  v_total   int;
  v_voltou  int := 0;
  v_inicio  timestamptz := clock_timestamp();
begin
  if p_account_id is null then
    raise exception 'cb_desfazer_encerramento_em_lote: p_account_id é obrigatório';
  end if;

  select count(*) into v_total
    from migracao_kommo.conversas_antes_do_encerramento
   where account_id = p_account_id;

  if p_conferir then
    return jsonb_build_object('a_devolver', v_total, 'desfez', false);
  end if;

  -- ⚠️⚠️ O DESFAZER É SILENCIOSO, e isto foi MEDIDO no ensaio de 21/09.
  -- `notify_conversation_assigned` sai cedo quando o novo responsável é NULO
  -- — por isso ENCERRAR não gera notificação nenhuma —, mas DEVOLVER o
  -- responsável é um `assigned_agent_id` que deixa de ser nulo, e aí ele
  -- insere "Someone assigned you a conversation" para cada um. O ensaio
  -- reprovou exatamente por isso: as notificações da conta foram de 10 para
  -- 16. Desfazer um encerramento em lote não pode avisar ninguém de nada.
  -- `ALTER TABLE ... DISABLE TRIGGER` é DDL TRANSACIONAL: se algo estourar
  -- aqui, o gatilho volta sozinho com o rollback. E é NOMINAL, não
  -- `USER` — `cb_encerrar_limpa_espera` e `set_updated_at` continuam de pé.
  alter table public.conversations disable trigger on_conversation_assigned;

  -- ⚠️ `aguardando_desde` volta pelo UPDATE, e o gatilho não atrapalha:
  -- `cb_encerrar_limpa_espera` só age na transição PARA 'closed', e aqui a
  -- conversa está SAINDO dela.
  update conversations v
     set status            = f.status,
         assigned_agent_id = f.assigned_agent_id,
         aguardando_desde  = f.aguardando_desde,
         unread_count      = coalesce(f.unread_count, 0)
    from migracao_kommo.conversas_antes_do_encerramento f
   where f.conversation_id = v.id
     and f.account_id = p_account_id
     and v.account_id = p_account_id;
  get diagnostics v_voltou = row_count;

  alter table public.conversations enable trigger on_conversation_assigned;

  delete from migracao_kommo.conversas_antes_do_encerramento
   where account_id = p_account_id;

  return jsonb_build_object(
    'devolvidas', v_voltou,
    'linhas',     v_total,
    'ms',         extract(milliseconds from clock_timestamp() - v_inicio));
end;
$desfazer$;

-- ------------------------------------------------------------
-- Privilégios — as DUAS metades, sempre (901/903/912/914 erraram isto).
-- ------------------------------------------------------------
revoke execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  to service_role;

revoke execute on function public.cb_desfazer_encerramento_em_lote(uuid, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_desfazer_encerramento_em_lote(uuid, boolean)
  to service_role;

-- ------------------------------------------------------------
-- Conferência — sem exigir dado que só existe nesta instalação.
-- ------------------------------------------------------------
do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)'::regprocedure;
  if v_corpo not like '%conversas_antes_do_encerramento%' then
    raise exception '1018: a função encerra sem tirar a foto do antes — seria irreversível';
  end if;
  if v_corpo not like '%p_incluir_grupos or v.group_id is null%' then
    raise exception '1018: grupo deixou de ser exceção — conversa de grupo encerrada NÃO reabre com mensagem no grupo';
  end if;
  if v_corpo not like '%assigned_agent_id = null%' then
    raise exception '1018: encerrar parou de soltar o responsável (regra de 02/09/2026)';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)'::regprocedure;
  if v_corpo not like '%aguardando_desde  = f.aguardando_desde%' then
    raise exception '1018: o desfazer não devolve o relógio do alerta de atraso';
  end if;
  if v_corpo not like '%disable trigger on_conversation_assigned%' then
    raise exception '1018: o desfazer voltou a notificar — devolver o responsável dispara a 027 (medido no ensaio)';
  end if;
  if v_corpo like '%disable trigger user%' then
    raise exception '1018: o desfazer silenciou gatilho demais — só o de atribuição pode cair';
  end if;

  if has_table_privilege('anon', 'migracao_kommo.conversas_antes_do_encerramento', 'SELECT')
     or has_table_privilege('authenticated', 'migracao_kommo.conversas_antes_do_encerramento', 'SELECT') then
    raise exception '1018: a foto ficou legível pelo navegador';
  end if;
  if not has_table_privilege('service_role', 'migracao_kommo.conversas_antes_do_encerramento', 'SELECT') then
    raise exception '1018: service_role não enxerga a foto';
  end if;

  if has_function_privilege('anon', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)', 'EXECUTE') then
    raise exception '1018: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)', 'EXECUTE') then
    raise exception '1018: service_role perdeu o execute';
  end if;

  raise notice '1018: encerrar em lote com foto do antes, grupo de fora por padrão.';
end
$conferir$;
