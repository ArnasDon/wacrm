-- ============================================================
-- 1020 — Três CORRIDAS que o Codex achou no PR #232, todas fechadas.
--
-- A revisão do head 820e6a0 levantou três janelas entre "ler" e "escrever"
-- nas funções que a carga e o encerramento usam. As três foram MEDIDAS antes
-- de consertar — a carga e o encerramento já tinham rodado em produção:
--
--   · mensagem de cliente escondida pelo encerramento em lote .......... 0
--     (nenhuma na janela de ±10 s; nenhuma conversa fechada pela operação
--     tem mensagem de cliente mais nova que ela — as 13 que clientes
--     escreveram depois foram reabertas sozinhas)
--   · ficha da carga duplicada pela outra grafia do nono dígito ......... 0
--
-- Nenhuma corrida aconteceu. O que se fecha aqui são os TRAPS: as três
-- funções continuam de pé para o delta do dia do corte e para quem as chamar
-- de novo.
--
--  1. ⚠️⚠️ P1 — o encerramento em lote podia ESCONDER mensagem nova. A
--     ingestão lê a conversa como aberta (então `reopenClosedConversation`
--     não reabre nada) e depois grava a não lida; se o UPDATE em lote entra
--     entre as duas, a conversa fecha com a mensagem do cliente dentro e a
--     não lida zerada — some da aba Abertas e parece lida. Agora: as linhas
--     são TRAVADAS (`FOR UPDATE SKIP LOCKED` — quem a ingestão está escrevendo
--     neste instante fica de fora) e conversa com mensagem de cliente
--     gravada nos últimos 2 minutos (`messages.gravada_em`, o relógio do
--     BANCO, 1003) também fica de fora. A leitura do status pela ingestão não
--     está na nossa transação, então só a trava não bastaria; a folga de 2
--     minutos é o que cobre esse intervalo.
--  2. P2 — o desfazer do encerramento atropelava o que aconteceu DEPOIS. Um
--     cliente que escreveu depois do encerramento reabre a conversa com
--     não lida nova e dono novo; o desfazer devolvia a foto velha por cima.
--     Agora ele só devolve a conversa INTOCADA desde o encerramento
--     (`updated_at` não passou da hora da operação — `set_updated_at` é
--     BEFORE UPDATE sem lista de colunas, então qualquer escrita o avança),
--     e a que mudou fica na foto e é reportada.
--  3. P2 — a ficha podia nascer duplicada pelo nono dígito. Ver o comentário
--     no ramo de inserção de `cb_kommo_carregar_pessoas`.
-- ============================================================

-- ------------------------------------------------------------
-- 3. `cb_kommo_carregar_pessoas` — o corpo da 1017, com o ramo de inserção
-- re-resolvendo a pessoa pelas duas grafias do nono dígito.
-- ------------------------------------------------------------

create or replace function public.cb_kommo_carregar_pessoas(
  p_account_id uuid,
  p_pessoas    jsonb,
  p_conferir   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $pessoas$
declare
  c_permitidos constant text[] := array[
    'tamanho_da_divida', 'nome_da_campanha', 'nome_do_conjunto',
    'nome_do_anuncio', 'kommo_contact_id'
  ];
  v_dono       uuid;
  v_pessoa     jsonb;
  v_par        record;
  v_telefone   text;
  v_contato    uuid;
  v_nome       text;
  v_email      text;
  v_antes      jsonb;
  v_campo      uuid;
  v_criados    int := 0;
  v_nomes      int := 0;
  v_emails     int := 0;
  v_valores    int := 0;
  v_titulos    int := 0;
  v_pulados    jsonb := '[]'::jsonb;
  v_inicio     timestamptz := clock_timestamp();
  v_chaves     text[];
  v_tel        text[] := '{}';
  v_irma       text;
  v_n          int;
begin
  if p_account_id is null then
    raise exception 'cb_kommo_carregar_pessoas: p_account_id é obrigatório';
  end if;
  if p_pessoas is null or jsonb_typeof(p_pessoas) <> 'array' then
    raise exception 'cb_kommo_carregar_pessoas: p_pessoas tem de ser um array jsonb (veio %)',
      coalesce(jsonb_typeof(p_pessoas), 'null');
  end if;

  select owner_user_id into v_dono from accounts where id = p_account_id;
  if v_dono is null then
    raise exception 'cb_kommo_carregar_pessoas: conta % não existe ou está sem owner_user_id',
      p_account_id;
  end if;

  for v_pessoa in select * from jsonb_array_elements(p_pessoas) loop
    v_telefone := v_pessoa->>'telefone';
    if v_telefone is null or v_telefone !~ '^[0-9]{10,15}$' then
      raise exception 'pessoa com telefone que não é 10-15 dígitos: % (regra 18)',
        coalesce(v_telefone, '(nulo)');
    end if;
    v_tel := v_tel || v_telefone;

    if (v_pessoa->>'contact_id') is not null
       and not exists (select 1 from contacts c
                        where c.id = (v_pessoa->>'contact_id')::uuid
                          and c.account_id = p_account_id) then
      raise exception 'telefone %: contato % não é desta conta', v_telefone, v_pessoa->>'contact_id';
    end if;

    select coalesce(array_agg(k), '{}') into v_chaves
      from jsonb_object_keys(coalesce(v_pessoa->'campos', '{}'::jsonb)) k;
    foreach v_nome in array v_chaves loop
      if not (v_nome = any (c_permitidos)) then
        raise exception 'telefone %: campo "%" está fora da allowlist da carga (regra 23)',
          v_telefone, v_nome;
      end if;
      if not exists (select 1 from custom_fields f
                      where f.account_id = p_account_id and f.field_key = v_nome) then
        raise exception 'o campo personalizado "%" não existe nesta conta (regra 22)', v_nome;
      end if;
    end loop;
  end loop;

  if p_conferir then
    return jsonb_build_object(
      'conferido', jsonb_array_length(p_pessoas),
      'escreveu', false,
      'ms', extract(milliseconds from clock_timestamp() - v_inicio));
  end if;

  -- ⚠️⚠️ SÓ `deals`, e só aqui. O espelho de e-mail (1000/1001) é gatilho de
  -- `contacts` e de `contact_custom_values` e continua LIGADO — silenciá-lo
  -- deixaria os e-mails sem espelho, que é o motivo de esta função existir
  -- fora da de lote. O que se silencia é o `set_updated_at` de `deals`, que
  -- `cb_titulo_do_card_segue_a_ficha` (1007) acorda por tabela interposta:
  -- trocar o nome de uma ficha que JÁ TEM card carimba `updated_at = now()`
  -- naquele card, e o cabeçalho do Kanban conta "ganhos/perdidos este mês"
  -- por essa coluna. A 1016 dizia que a ordem pessoas→cards resolvia; resolve
  -- para o card que a carga vai CRIAR, não para os que já existem.
  alter table public.deals disable trigger user;

  for v_pessoa in select * from jsonb_array_elements(p_pessoas) loop
    v_telefone := v_pessoa->>'telefone';
    v_contato  := nullif(v_pessoa->>'contact_id', '')::uuid;
    v_nome     := nullif(btrim(coalesce(v_pessoa->>'nome', '')), '');
    v_email    := nullif(btrim(coalesce(v_pessoa->>'email', '')), '');

    -- ⚠️⚠️ A PESSOA É RE-RESOLVIDA AQUI, pelas DUAS grafias do nono dígito
    -- (Codex, PR #232). Quem chamou resolveu minutos antes, e a ingestão
    -- continua viva: se o cliente escreveu nesse meio pelo número com a
    -- OUTRA grafia, a ficha nasceu com `phone_normalized` diferente — e o
    -- índice único parcial compara igualdade EXATA, então o INSERT abaixo
    -- NÃO conflita e cria a duplicata que a régua do nono dígito
    -- (`variantesDoNonoDigito`, regra 18c) existe para impedir. Achando
    -- uma, ela é tratada como ficha que JÁ EXISTE: vai para o ramo de baixo,
    -- onde o nome só é tocado se estiver vazio ou for telefone.
    -- (Medido depois da carga de 21/09: 0 duplicatas — o que se fecha aqui é
    -- a janela para o delta do dia do corte.)
    v_irma := case
      when v_telefone like '55%' and length(v_telefone) = 13
           and substr(v_telefone, 5, 1) = '9' and substr(v_telefone, 6, 1) between '6' and '9'
        then substr(v_telefone, 1, 4) || substr(v_telefone, 6)
      when v_telefone like '55%' and length(v_telefone) = 12
           and substr(v_telefone, 5, 1) between '6' and '9'
        then substr(v_telefone, 1, 4) || '9' || substr(v_telefone, 5)
    end;

    if v_contato is null then
      select id into v_contato
        from contacts
       where account_id = p_account_id
         and phone_normalized in (v_telefone, coalesce(v_irma, v_telefone))
       order by created_at asc nulls last, id asc
       limit 1;
    end if;

    if v_contato is null then
      insert into contacts (account_id, user_id, name, phone, nome_fixado_em)
      values (p_account_id, v_dono, coalesce(v_nome, v_telefone), v_telefone,
              case when v_nome is not null and (v_pessoa->>'fixar_nome')::boolean is true
                   then now() end)
      on conflict (account_id, phone_normalized) where phone_normalized <> ''
      do nothing
      returning id into v_contato;

      if v_contato is not null then
        insert into migracao_kommo.livro_razao (account_id, acao, tabela, registro_id)
        values (p_account_id, 'criou', 'contacts', v_contato);
        v_criados := v_criados + 1;
      else
        select id into v_contato
          from contacts
         where account_id = p_account_id
           and phone_normalized in (v_telefone, coalesce(v_irma, v_telefone))
         order by created_at asc nulls last, id asc
         limit 1;
        if v_contato is null then
          v_pulados := v_pulados || jsonb_build_object('telefone', v_telefone, 'motivo', 'sem_ficha');
          continue;
        end if;
      end if;

    else
      -- ⚠️ Regra 27: só sobrescreve nome VAZIO ou que é TELEFONE, e só quando
      -- ninguém o fixou à mão. E só quando quem chamou disse que o nome é
      -- FIXÁVEL — rótulo automático da Kommo ("Lead #21438851", ".", "oi")
      -- congelado aqui nunca mais seria corrigido pelo WhatsApp, porque os
      -- três caminhos de ingestão respeitam `nome_fixado_em` (999).
      if v_nome is not null and (v_pessoa->>'fixar_nome')::boolean is true then
        select to_jsonb(c) - 'phone_normalized' into v_antes
          from contacts c
         where c.id = v_contato and c.account_id = p_account_id
           and c.nome_fixado_em is null
           and (c.name is null or btrim(c.name) = '' or btrim(c.name) ~ '^[0-9 ()+-]+$')
           and btrim(c.name) is distinct from v_nome;
        if v_antes is not null then
          -- O gatilho da 1007 vai reescrever o título dos cards deste
          -- contato. Eles entram no livro ANTES, senão o desfazer devolve o
          -- nome da ficha e deixa o título do card com o nome da Kommo.
          insert into migracao_kommo.livro_razao
                 (account_id, acao, tabela, registro_id, antes, detalhe)
          select p_account_id, 'alterou', 'deals', d.id, to_jsonb(d),
                 jsonb_build_object('o_que', 'titulo')
            from deals d
           where d.account_id = p_account_id and d.contact_id = v_contato;
          get diagnostics v_n = row_count; v_titulos := v_titulos + v_n;

          update contacts
             set name = v_nome, nome_fixado_em = now()
           where id = v_contato and account_id = p_account_id;
          insert into migracao_kommo.livro_razao
                 (account_id, acao, tabela, registro_id, antes, detalhe)
          values (p_account_id, 'alterou', 'contacts', v_contato, v_antes,
                  jsonb_build_object('o_que', 'nome'));
          v_nomes := v_nomes + 1;
        end if;
      end if;
    end if;

    if v_email is not null then
      select to_jsonb(c) - 'phone_normalized' into v_antes
        from contacts c
       where c.id = v_contato and c.account_id = p_account_id
         and (c.email is null or btrim(c.email) = '');
      if v_antes is not null then
        update contacts set email = v_email
         where id = v_contato and account_id = p_account_id;
        insert into migracao_kommo.livro_razao
               (account_id, acao, tabela, registro_id, antes, detalhe)
        values (p_account_id, 'alterou', 'contacts', v_contato, v_antes,
                jsonb_build_object('o_que', 'email'));
        v_emails := v_emails + 1;
      end if;
    end if;

    for v_par in
      select key as chave, value #>> '{}' as valor
        from jsonb_each(coalesce(v_pessoa->'campos', '{}'::jsonb))
    loop
      if nullif(btrim(coalesce(v_par.valor, '')), '') is null then
        continue;
      end if;
      select id into v_campo from custom_fields
       where account_id = p_account_id and field_key = v_par.chave;

      insert into contact_custom_values (contact_id, custom_field_id, value)
      values (v_contato, v_campo, btrim(v_par.valor))
      on conflict (contact_id, custom_field_id) do nothing;

      if found then
        insert into migracao_kommo.livro_razao
               (account_id, acao, tabela, registro_id, detalhe)
        values (p_account_id, 'criou', 'contact_custom_values', v_contato,
                jsonb_build_object('custom_field_id', v_campo, 'field_key', v_par.chave));
        v_valores := v_valores + 1;
      end if;
    end loop;
  end loop;

  alter table public.deals enable trigger user;

  -- ⚠️ Pós-voo da regra 18 sobre OS TELEFONES DO LOTE, não sobre a conta: uma
  -- ficha alheia com separador (criada por qualquer outro caminho) derrubaria
  -- todo lote seguinte sem que o lote tivesse culpa, e a carga pararia no meio.
  if exists (select 1 from contacts
              where account_id = p_account_id
                and phone_normalized = any (v_tel)
                and phone is not null and phone ~ '[^0-9+]') then
    raise exception 'o lote deixou ficha com separador no telefone — regra 18';
  end if;

  return jsonb_build_object(
    'pessoas',  jsonb_array_length(p_pessoas),
    'criados',  v_criados,
    'nomes',    v_nomes,
    'emails',   v_emails,
    'valores',  v_valores,
    'titulos',  v_titulos,
    'pulados',  v_pulados,
    'ms',       extract(milliseconds from clock_timestamp() - v_inicio));
end;
$pessoas$;


-- ------------------------------------------------------------
-- 1. `cb_encerrar_conversas_abertas` — trava, e pula quem acabou de escrever.
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
  on conflict (conversation_id) do nothing;
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

-- ------------------------------------------------------------
-- 2. `cb_desfazer_encerramento_em_lote` — só devolve o que ficou intocado.
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
  v_total    int;
  v_voltou   int := 0;
  v_mudaram  int;
  v_inicio   timestamptz := clock_timestamp();
begin
  if p_account_id is null then
    raise exception 'cb_desfazer_encerramento_em_lote: p_account_id é obrigatório';
  end if;

  select count(*) into v_total
    from migracao_kommo.conversas_antes_do_encerramento
   where account_id = p_account_id;

  -- ⚠️⚠️ "INTOCADA desde o encerramento" é `updated_at` que não passou da
  -- hora da operação (Codex, PR #232). O encerramento grava a foto e fecha a
  -- conversa na mesma transação, então as duas colunas saem com o MESMO
  -- `now()`; `set_updated_at` é BEFORE UPDATE sem lista de colunas, e
  -- qualquer escrita posterior — o cliente reabrindo, a equipe respondendo,
  -- uma não lida nova — o empurra para a frente. Devolver a foto por cima
  -- disso apagaria a não lida e o dono de uma conversa viva.
  select count(*) into v_mudaram
    from migracao_kommo.conversas_antes_do_encerramento f
    join conversations v on v.id = f.conversation_id
   where f.account_id = p_account_id
     and (v.status <> 'closed' or v.updated_at > f.encerrado_em);

  if p_conferir then
    return jsonb_build_object('a_devolver', v_total - v_mudaram,
                              'mudaram_depois', v_mudaram, 'desfez', false);
  end if;

  alter table public.conversations disable trigger on_conversation_assigned;

  -- ⚠️ Sai da foto EXATAMENTE o que voltou — pelo `RETURNING` do próprio
  -- UPDATE, e não por uma segunda consulta tentando adivinhar depois (o
  -- UPDATE acabou de empurrar `updated_at`, e aí "voltou" e "mudou depois"
  -- ficam indistinguíveis). A conversa que mudou depois do encerramento
  -- FICA na foto: é a prova do estado de antes, para quem precisar decidir
  -- à mão — o mesmo princípio do livro-razão da 1017, que não apaga a linha
  -- que não conseguiu desfazer. Data-modifying CTE roda sempre, mesmo sem
  -- ser referenciada.
  with devolvidas as (
    update conversations v
       set status            = f.status,
           assigned_agent_id = f.assigned_agent_id,
           aguardando_desde  = f.aguardando_desde,
           unread_count      = coalesce(f.unread_count, 0)
      from migracao_kommo.conversas_antes_do_encerramento f
     where f.conversation_id = v.id
       and f.account_id = p_account_id
       and v.account_id = p_account_id
       and v.status = 'closed'
       and v.updated_at <= f.encerrado_em
    returning v.id
  ), limpa as (
    delete from migracao_kommo.conversas_antes_do_encerramento f
     using devolvidas d
     where f.conversation_id = d.id
    returning 1
  )
  select count(*) into v_voltou from devolvidas;

  alter table public.conversations enable trigger on_conversation_assigned;

  -- conversa APAGADA depois do encerramento não tem o que devolver
  delete from migracao_kommo.conversas_antes_do_encerramento f
   where f.account_id = p_account_id
     and not exists (select 1 from conversations v where v.id = f.conversation_id);

  return jsonb_build_object(
    'devolvidas',     v_voltou,
    'mudaram_depois', v_mudaram,
    'linhas',         v_total,
    'ms', extract(milliseconds from clock_timestamp() - v_inicio));
end;
$desfazer$;

-- ------------------------------------------------------------
-- Privilégios — as DUAS metades, sempre.
-- ------------------------------------------------------------
revoke execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  to service_role;
revoke execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)
  to service_role;
revoke execute on function public.cb_desfazer_encerramento_em_lote(uuid, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_desfazer_encerramento_em_lote(uuid, boolean)
  to service_role;

do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)'::regprocedure;
  if v_corpo not like '%for update of v skip locked%' then
    raise exception '1020: o encerramento voltou a não travar as conversas — pode esconder mensagem nova';
  end if;
  if v_corpo not like '%gravada_em > now() - interval ''2 minutes''%' then
    raise exception '1020: o encerramento perdeu a folga de 2 minutos sobre quem acabou de escrever';
  end if;
  if v_corpo not like '%conversas_antes_do_encerramento%' then
    raise exception '1020: o encerramento voltou a fechar sem foto';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)'::regprocedure;
  if v_corpo not like '%v.updated_at <= f.encerrado_em%' then
    raise exception '1020: o desfazer voltou a atropelar conversa que mudou depois do encerramento';
  end if;
  if v_corpo not like '%disable trigger on_conversation_assigned%' then
    raise exception '1020: o desfazer voltou a notificar a devolução do responsável';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%phone_normalized in (v_telefone, coalesce(v_irma, v_telefone))%' then
    raise exception '1020: a ficha voltou a nascer sem olhar a outra grafia do nono dígito';
  end if;
  -- as guardas da 1016/1017 continuam de pé
  if v_corpo not like '%alter table public.deals disable trigger user%'
     or v_corpo not like '%fixar_nome%' or v_corpo not like '%^[0-9]{10,15}$%' then
    raise exception '1020: a função de pessoas perdeu uma guarda da 1016/1017';
  end if;

  if has_function_privilege('anon', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1020: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_encerrar_conversas_abertas(uuid, boolean, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_desfazer_encerramento_em_lote(uuid, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1020: service_role perdeu o execute';
  end if;

  raise notice '1020: as três corridas do PR #232 estão fechadas.';
end
$conferir$;
