-- ============================================================
-- 1021 — Encerrar DE NOVO não pode tornar o encerramento irreversível.
--
-- Achado do Codex no PR #232, sobre a 1020: a foto do antes era da PRIMEIRA
-- operação (`on conflict do nothing`). A conversa que um cliente reabriu depois
-- do encerramento de 21/09 — e já são 16 — continuava com a foto de antes do
-- primeiro. Rodando o encerramento de novo, ela fecha outra vez com
-- `updated_at` mais novo que aquele `encerrado_em` velho, e o desfazer da 1020
-- a lê como "mudou depois": o segundo encerramento não tinha volta.
--
-- Agora a foto é de CADA operação. O desfazer devolve cada conversa ao estado
-- em que estava imediatamente antes do encerramento MAIS RECENTE que a fechou
-- — que é o que "desfazer" quer dizer.
--
-- Só a cláusula ON CONFLICT muda; o resto é o corpo vigente da 1020.
-- ============================================================

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
  v_ids       uuid[];
  v_recentes  int;
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

  -- Quem fica de fora por ter falado AGORA — contado à parte, para o
  -- operador saber que não foram esquecidas.
  select count(*) into v_recentes
    from conversations v
   where v.account_id = p_account_id
     and v.status <> 'closed'
     and (p_incluir_grupos or v.group_id is null)
     and exists (select 1 from messages m
                  where m.conversation_id = v.id
                    and m.sender_type = 'customer'
                    and m.gravada_em > now() - interval '2 minutes');

  -- ⚠️⚠️ O alvo é TRAVADO, e a trava pula quem já está travado. `SKIP LOCKED`
  -- deixa de fora a conversa que a ingestão está escrevendo neste instante
  -- (a não lida é um UPDATE na mesma linha). E a folga de 2 minutos sobre
  -- `gravada_em` cobre o que a trava não alcança: a ingestão LÊ o status
  -- fora da nossa transação e só depois escreve (Codex, PR #232).
  -- Em modo de conferência não se trava nada: é só contagem.
  if p_conferir then
    select array_agg(v.id) into v_ids
      from conversations v
     where v.account_id = p_account_id
       and v.status <> 'closed'
       and (p_incluir_grupos or v.group_id is null)
       and not exists (select 1 from messages m
                        where m.conversation_id = v.id
                          and m.sender_type = 'customer'
                          and m.gravada_em > now() - interval '2 minutes');
  else
    select array_agg(s.id) into v_ids
      from (select v.id
              from conversations v
             where v.account_id = p_account_id
               and v.status <> 'closed'
               and (p_incluir_grupos or v.group_id is null)
               and not exists (select 1 from messages m
                                where m.conversation_id = v.id
                                  and m.sender_type = 'customer'
                                  and m.gravada_em > now() - interval '2 minutes')
             for update of v skip locked) s;
  end if;
  v_ids := coalesce(v_ids, '{}');

  select count(*) filter (where group_id is not null),
         count(*) filter (where unread_count > 0),
         count(*) filter (where assigned_agent_id is not null)
    into v_grupos, v_naolidas, v_donos
    from conversations where id = any (v_ids);

  if p_conferir then
    return jsonb_build_object(
      'a_encerrar', coalesce(array_length(v_ids, 1), 0), 'de_grupo', v_grupos,
      'com_nao_lidas', v_naolidas, 'com_responsavel', v_donos,
      'poupadas_por_falar_agora', v_recentes,
      'escreveu', false,
      'ms', extract(milliseconds from clock_timestamp() - v_inicio));
  end if;

  insert into migracao_kommo.conversas_antes_do_encerramento
         (conversation_id, account_id, status, assigned_agent_id,
          aguardando_desde, unread_count, era_grupo)
  select v.id, v.account_id, v.status, v.assigned_agent_id,
         v.aguardando_desde, v.unread_count, (v.group_id is not null)
    from conversations v
   where v.id = any (v_ids)
  -- ⚠️⚠️ A FOTO É DE CADA OPERAÇÃO, não da primeira (Codex, PR #232). Com
  -- `do nothing`, uma conversa que o cliente reabriu depois do primeiro
  -- encerramento guardava a foto de ANTES do primeiro; encerrada de novo,
  -- ela ficava com `updated_at` mais novo que o `encerrado_em` velho, e o
  -- desfazer a classificava como "mudou depois" — o segundo encerramento
  -- ficava irreversível. Só entra aqui quem está sendo encerrado AGORA
  -- (`v_ids`), então a troca só alcança conversa reaberta desde a última vez,
  -- e o estado dela neste instante é exatamente o que o desfazer tem de
  -- devolver.
  on conflict (conversation_id) do update
     set account_id        = excluded.account_id,
         status            = excluded.status,
         assigned_agent_id = excluded.assigned_agent_id,
         aguardando_desde  = excluded.aguardando_desde,
         unread_count      = excluded.unread_count,
         era_grupo         = excluded.era_grupo,
         encerrado_em      = excluded.encerrado_em;
  get diagnostics v_fotos = row_count;

  update conversations v
     set status            = 'closed',
         assigned_agent_id = null,
         unread_count      = 0
   where v.id = any (v_ids)
     and v.status <> 'closed';
  get diagnostics v_fechadas = row_count;

  return jsonb_build_object(
    'encerradas',               v_fechadas,
    'fotografadas',             v_fotos,
    'de_grupo',                 v_grupos,
    'nao_lidas_zeradas',        v_naolidas,
    'responsaveis_soltos',      v_donos,
    'poupadas_por_falar_agora', v_recentes,
    'ms', extract(milliseconds from clock_timestamp() - v_inicio));
end;
$encerrar$;


revoke execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  to service_role;

do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)'::regprocedure;
  if v_corpo like '%on conflict (conversation_id) do nothing%' then
    raise exception '1021: a foto voltou a ser só da primeira operação — o segundo encerramento ficaria sem volta';
  end if;
  if v_corpo not like '%encerrado_em      = excluded.encerrado_em%' then
    raise exception '1021: a foto nova não renova a hora da operação — o desfazer leria tudo como "mudou depois"';
  end if;
  -- o que a 1020 trouxe tem de continuar de pé
  if v_corpo not like '%for update of v skip locked%'
     or v_corpo not like '%gravada_em > now() - interval ''2 minutes''%' then
    raise exception '1021: o encerramento perdeu a trava ou a folga da 1020';
  end if;
  if has_function_privilege('anon', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE') then
    raise exception '1021: a função ficou executável pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE') then
    raise exception '1021: service_role perdeu o execute';
  end if;
  raise notice '1021: a foto do encerramento é de cada operação.';
end
$conferir$;
