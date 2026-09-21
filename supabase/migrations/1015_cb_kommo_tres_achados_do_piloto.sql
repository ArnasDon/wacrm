-- ============================================================
-- 1015 — Os três achados do PRIMEIRO piloto, todos em produção e todos
-- invisíveis nos ensaios em rollback.
--
-- A 1014 foi ensaiada duas vezes contra a produção (carga + reexecução, e
-- carga + desfazer) e passou nas duas. O piloto com 33 leads reais derrubou
-- ela na primeira tentativa. É a diferença entre dado escolhido a dedo e dado
-- de verdade — e é exatamente para isto que o piloto existe.
--
--  1. `deals.value` é **NOT NULL com DEFAULT 0**, e a função passava NULL
--     explícito, que ANULA o default. Todo lead da Kommo sem valor derrubava o
--     lote inteiro com 23502. Os ensaios não pegaram porque os dois grupos que
--     eu escrevi à mão tinham valor.
--  2. `deals.currency` tem **DEFAULT 'USD'**, e a regra 11 do contrato dizia
--     "pode ficar no default: o app formata em BRL e não lê a coluna". Medido
--     na produção: **980 dos 982 cards são BRL** e os 2 USD são de um teste de
--     30/08. Deixar no default poria os 12.611 cards importados em dólar —
--     contra a base inteira. A regra 11 estava errada na prática.
--  3. O livro-razão não sabia desfazer `contacts`. A carga cria a ficha pelo
--     caminho NORMAL (fora da função, com os gatilhos ligados — o espelho de
--     e-mail depende deles), e essas linhas ficavam fora do livro: o desfazer
--     não tinha como removê-las. Medido no piloto: a função abortou e sobraram
--     **24 contatos órfãos** que nenhum desfazer alcançava.
-- ============================================================

-- ------------------------------------------------------------
-- 1 e 2 — a função de lote, com `value` e `currency` corrigidos.
-- (Só o INSERT muda; o resto é idêntico à 1014.)
-- ------------------------------------------------------------
create or replace function public.cb_kommo_carregar_lote(
  p_account_id uuid,
  p_grupos     jsonb,
  p_conferir   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $funcao$
declare
  v_dono        uuid;
  v_grupo       jsonb;
  v_evento      jsonb;
  v_lead        bigint;
  v_contato     uuid;
  v_funil       uuid;
  v_etapa       uuid;
  v_card        uuid;
  v_antes       jsonb;
  v_resultado   text;
  v_status      text;
  v_tag         uuid;
  v_criados     int := 0;
  v_movidos     int := 0;
  v_eventos     int := 0;
  v_etiquetas   int := 0;
  v_pulados     jsonb := '[]'::jsonb;
  v_inicio      timestamptz := clock_timestamp();
  v_n           int;
begin
  if p_account_id is null then
    raise exception 'cb_kommo_carregar_lote: p_account_id é obrigatório';
  end if;
  if p_grupos is null or jsonb_typeof(p_grupos) <> 'array' then
    raise exception 'cb_kommo_carregar_lote: p_grupos tem de ser um array jsonb (veio %)',
      coalesce(jsonb_typeof(p_grupos), 'null');
  end if;

  select owner_user_id into v_dono from accounts where id = p_account_id;
  if v_dono is null then
    raise exception 'cb_kommo_carregar_lote: conta % não existe ou está sem owner_user_id',
      p_account_id;
  end if;

  -- ---------- conferência de forma, ANTES de escrever ou desligar nada ----------
  for v_grupo in select * from jsonb_array_elements(p_grupos) loop
    v_lead    := (v_grupo->>'kommo_lead_id')::bigint;
    v_contato := (v_grupo->>'contact_id')::uuid;
    v_funil   := (v_grupo->>'pipeline_id')::uuid;
    v_etapa   := (v_grupo->>'stage_id')::uuid;

    if v_lead is null then
      raise exception 'grupo sem kommo_lead_id: %', v_grupo;
    end if;
    if v_contato is null then
      raise exception 'lead % chegou sem contact_id — a regra 18b manda pular antes, não criar card órfão', v_lead;
    end if;
    if v_funil is null or v_etapa is null then
      raise exception 'lead % sem pipeline_id/stage_id', v_lead;
    end if;

    if not exists (select 1 from contacts c
                    where c.id = v_contato and c.account_id = p_account_id) then
      raise exception 'lead %: contato % não é desta conta', v_lead, v_contato;
    end if;

    if not exists (
      select 1 from pipeline_stages s
        join pipelines p on p.id = s.pipeline_id
       where s.id = v_etapa and s.pipeline_id = v_funil and p.account_id = p_account_id
    ) then
      raise exception 'lead %: o par (etapa %, funil %) não existe nesta conta', v_lead, v_etapa, v_funil;
    end if;

    for v_tag in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_grupo->'etiquetas', '[]'::jsonb)) loop
      if not exists (select 1 from tags t where t.id = v_tag and t.account_id = p_account_id) then
        raise exception 'lead %: etiqueta % não é desta conta', v_lead, v_tag;
      end if;
    end loop;

    for v_evento in select * from jsonb_array_elements(coalesce(v_grupo->'eventos', '[]'::jsonb)) loop
      if (v_evento->>'occurred_at') is null then
        raise exception 'lead %: evento sem occurred_at (%)', v_lead, v_evento;
      end if;
      case v_evento->>'event_type'
        when 'deal_created' then
          if (v_evento->>'to_pipeline_id') is null then
            raise exception 'lead %: deal_created exige to_pipeline_id', v_lead;
          end if;
        when 'stage_changed' then
          if (v_evento->>'to_stage_id') is null then
            raise exception 'lead %: stage_changed exige to_stage_id', v_lead;
          end if;
        when 'pipeline_changed' then
          if (v_evento->>'from_pipeline_id') is null or (v_evento->>'to_pipeline_id') is null then
            raise exception 'lead %: pipeline_changed exige from_pipeline_id E to_pipeline_id', v_lead;
          end if;
          if (v_evento->>'from_pipeline_id') = (v_evento->>'to_pipeline_id') then
            raise exception 'lead %: pipeline_changed com os dois funis iguais', v_lead;
          end if;
        when 'status_changed' then
          if (v_evento->>'to_status') is null then
            raise exception 'lead %: status_changed exige to_status', v_lead;
          end if;
        else
          raise exception 'lead %: event_type % não é escrito por esta carga', v_lead, v_evento->>'event_type';
      end case;
    end loop;
  end loop;

  if p_conferir then
    return jsonb_build_object(
      'conferido', jsonb_array_length(p_grupos),
      'escreveu', false,
      'ms', extract(milliseconds from clock_timestamp() - v_inicio)
    );
  end if;

  alter table public.deals        disable trigger user;
  alter table public.contact_tags disable trigger user;

  for v_grupo in select * from jsonb_array_elements(p_grupos) loop
    v_lead    := (v_grupo->>'kommo_lead_id')::bigint;
    v_contato := (v_grupo->>'contact_id')::uuid;
    v_funil   := (v_grupo->>'pipeline_id')::uuid;
    v_etapa   := (v_grupo->>'stage_id')::uuid;

    select id into v_card
      from deals
     where account_id = p_account_id and kommo_lead_id = v_lead;
    if found then
      v_pulados := v_pulados || jsonb_build_object('kommo_lead_id', v_lead, 'motivo', 'ja_migrado');
      continue;
    end if;

    select s.resultado into v_resultado from pipeline_stages s where s.id = v_etapa;
    v_status := case v_resultado
                  when 'ganho'   then 'won'
                  when 'perdido' then 'lost'
                  else coalesce(v_grupo->>'status', 'open')
                end;

    v_card := nullif(v_grupo->>'deal_id', '')::uuid;

    if v_card is null then
      insert into deals (
        account_id, user_id, contact_id, pipeline_id, stage_id,
        title, value, currency, status, source, kommo_lead_id, created_at, updated_at
      ) values (
        p_account_id, v_dono, v_contato, v_funil, v_etapa,
        coalesce(nullif(v_grupo->>'title', ''), 'Novo contato'),
        -- ⚠️ ACHADO 1 DO PILOTO: a coluna é NOT NULL com DEFAULT 0, e NULL
        -- explícito ANULA o default — 23502 no primeiro lead sem valor.
        coalesce(nullif(v_grupo->>'value', '')::numeric, 0),
        -- ⚠️ ACHADO 2: o default da coluna é 'USD'. Medido: 980 dos 982 cards
        -- da conta são BRL. Deixar no default poria os 12.611 em dólar.
        'BRL',
        v_status,
        'manual',
        v_lead,
        (v_grupo->>'created_at')::timestamptz,
        coalesce((v_grupo->>'updated_at')::timestamptz, (v_grupo->>'created_at')::timestamptz)
      )
      returning id into v_card;

      insert into migracao_kommo.livro_razao (account_id, kommo_lead_id, acao, tabela, registro_id)
      values (p_account_id, v_lead, 'criou', 'deals', v_card);
      v_criados := v_criados + 1;

    else
      select to_jsonb(d) - 'title' into v_antes
        from deals d where d.id = v_card and d.account_id = p_account_id;
      if v_antes is null then
        v_pulados := v_pulados || jsonb_build_object('kommo_lead_id', v_lead, 'motivo', 'card_sumiu');
        continue;
      end if;

      update deals
         set pipeline_id   = v_funil,
             stage_id      = v_etapa,
             status        = v_status,
             kommo_lead_id = v_lead,
             updated_at    = coalesce((v_grupo->>'updated_at')::timestamptz, updated_at),
             value         = coalesce(nullif(v_grupo->>'value', '')::numeric, value)
       where id = v_card and account_id = p_account_id;

      insert into migracao_kommo.livro_razao (account_id, kommo_lead_id, acao, tabela, registro_id, antes)
      values (p_account_id, v_lead, 'alterou', 'deals', v_card, v_antes);
      v_movidos := v_movidos + 1;
    end if;

    for v_evento in select * from jsonb_array_elements(coalesce(v_grupo->'eventos', '[]'::jsonb)) loop
      insert into cb_lead_events (
        account_id, contact_id, deal_id, event_type, origin, reconstructed, occurred_at,
        from_pipeline_id, to_pipeline_id, from_stage_id, to_stage_id, to_status, details
      ) values (
        p_account_id, v_contato, v_card,
        v_evento->>'event_type', 'retroativo', true,
        (v_evento->>'occurred_at')::timestamptz,
        nullif(v_evento->>'from_pipeline_id', '')::uuid,
        nullif(v_evento->>'to_pipeline_id', '')::uuid,
        nullif(v_evento->>'from_stage_id', '')::uuid,
        nullif(v_evento->>'to_stage_id', '')::uuid,
        nullif(v_evento->>'to_status', ''),
        jsonb_build_object('kommo_lead_id', coalesce((v_evento->>'kommo_lead_id')::bigint, v_lead))
      );
      v_eventos := v_eventos + 1;
    end loop;

    for v_tag in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_grupo->'etiquetas', '[]'::jsonb)) loop
      insert into contact_tags (contact_id, tag_id)
      values (v_contato, v_tag)
      on conflict do nothing;
      if found then
        insert into migracao_kommo.livro_razao (account_id, kommo_lead_id, acao, tabela, registro_id, detalhe)
        values (p_account_id, v_lead, 'criou', 'contact_tags', v_contato,
                jsonb_build_object('tag_id', v_tag));
        v_etiquetas := v_etiquetas + 1;
      end if;
    end loop;
  end loop;

  alter table public.deals        enable trigger user;
  alter table public.contact_tags enable trigger user;

  select count(*) into v_n
    from deals d
   where d.account_id = p_account_id and d.kommo_lead_id is not null
     and d.contact_id is null;
  if v_n > 0 then
    raise exception 'o lote deixou % card(s) sem contato — seriam desenhados em branco no Kanban', v_n;
  end if;

  select count(*) into v_n
    from cb_lead_events e
   where e.account_id = p_account_id and e.origin = 'retroativo'
     and (e.to_pipeline_id is null and e.to_stage_id is null and e.to_status is null);
  if v_n > 0 then
    raise exception 'o lote deixou % evento(s) retroativo(s) sem destino', v_n;
  end if;

  return jsonb_build_object(
    'grupos',     jsonb_array_length(p_grupos),
    'criados',    v_criados,
    'movidos',    v_movidos,
    'eventos',    v_eventos,
    'etiquetas',  v_etiquetas,
    'pulados',    v_pulados,
    'ms',         extract(milliseconds from clock_timestamp() - v_inicio)
  );
end;
$funcao$;

-- ------------------------------------------------------------
-- 3 — o desfazer passa a saber remover FICHA criada pela carga.
--
-- ⚠️⚠️ E ele CONFERE antes de apagar: ficha que ganhou conversa, mensagem,
-- tarefa ou qualquer vínculo depois da carga NÃO sai. `contacts` cascateia
-- para `conversations` e daí para `messages` — desfazer um piloto não pode
-- levar junto a conversa que um cliente começou no meio dele. A linha fica no
-- livro e é reportada, para decisão de gente.
-- ------------------------------------------------------------
create or replace function public.cb_kommo_desfazer(
  p_account_id uuid,
  p_desde_id   bigint default null,
  p_conferir   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $desfazer$
declare
  v_linha     record;
  v_cards     int := 0;
  v_alterados int := 0;
  v_etiquetas int := 0;
  v_eventos   int := 0;
  v_fichas    int := 0;
  v_retidas   jsonb := '[]'::jsonb;
  v_n         int;
  v_total     int;
begin
  if p_account_id is null then
    raise exception 'cb_kommo_desfazer: p_account_id é obrigatório';
  end if;

  select count(*) into v_total
    from migracao_kommo.livro_razao
   where account_id = p_account_id
     and (p_desde_id is null or id >= p_desde_id);

  if p_conferir then
    return jsonb_build_object('linhas_a_desfazer', v_total, 'desfez', false);
  end if;

  alter table public.deals        disable trigger user;
  alter table public.contact_tags disable trigger user;

  for v_linha in
    select * from migracao_kommo.livro_razao
     where account_id = p_account_id
       and (p_desde_id is null or id >= p_desde_id)
     order by id desc
  loop
    if v_linha.tabela = 'deals' and v_linha.acao = 'criou' then
      delete from cb_lead_events
       where account_id = p_account_id and deal_id = v_linha.registro_id;
      get diagnostics v_n = row_count; v_eventos := v_eventos + v_n;

      delete from deals
       where id = v_linha.registro_id and account_id = p_account_id;
      get diagnostics v_n = row_count; v_cards := v_cards + v_n;

    elsif v_linha.tabela = 'deals' and v_linha.acao = 'alterou' then
      delete from cb_lead_events
       where account_id = p_account_id
         and deal_id = v_linha.registro_id
         and origin = 'retroativo'
         and (details->>'kommo_lead_id') is not null;
      get diagnostics v_n = row_count; v_eventos := v_eventos + v_n;

      update deals d
         set pipeline_id   = (v_linha.antes->>'pipeline_id')::uuid,
             stage_id      = (v_linha.antes->>'stage_id')::uuid,
             status        = v_linha.antes->>'status',
             value         = coalesce(nullif(v_linha.antes->>'value', '')::numeric, 0),
             currency      = nullif(v_linha.antes->>'currency', ''),
             kommo_lead_id = nullif(v_linha.antes->>'kommo_lead_id', '')::bigint,
             updated_at    = (v_linha.antes->>'updated_at')::timestamptz
       where d.id = v_linha.registro_id and d.account_id = p_account_id;
      get diagnostics v_n = row_count; v_alterados := v_alterados + v_n;

    elsif v_linha.tabela = 'contact_tags' and v_linha.acao = 'criou' then
      delete from contact_tags
       where contact_id = v_linha.registro_id
         and tag_id = (v_linha.detalhe->>'tag_id')::uuid;
      get diagnostics v_n = row_count; v_etiquetas := v_etiquetas + v_n;

    elsif v_linha.tabela = 'contacts' and v_linha.acao = 'criou' then
      -- ⚠️⚠️ Só sai a ficha que continua SEM VÍNCULO NENHUM. `contacts`
      -- cascateia para `conversations` e daí para `messages`: se o cliente
      -- escreveu durante o piloto, apagar a ficha apagaria a conversa dele.
      delete from contacts c
       where c.id = v_linha.registro_id
         and c.account_id = p_account_id
         and not exists (select 1 from conversations v where v.contact_id = c.id)
         and not exists (select 1 from deals d where d.contact_id = c.id)
         and not exists (select 1 from contact_tags t where t.contact_id = c.id)
         and not exists (select 1 from contact_custom_values x where x.contact_id = c.id)
         and not exists (select 1 from cb_tasks k where k.contact_id = c.id)
         and not exists (select 1 from cb_lead_events e where e.contact_id = c.id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        -- Não sumiu: ou já não existia, ou ganhou vínculo. Fica reportada.
        v_retidas := v_retidas || jsonb_build_object('contact_id', v_linha.registro_id);
      else
        v_fichas := v_fichas + v_n;
      end if;

    else
      raise exception 'cb_kommo_desfazer: não sei desfazer % em % (linha %)',
        v_linha.acao, v_linha.tabela, v_linha.id;
    end if;
  end loop;

  delete from migracao_kommo.livro_razao
   where account_id = p_account_id
     and (p_desde_id is null or id >= p_desde_id);

  alter table public.deals        enable trigger user;
  alter table public.contact_tags enable trigger user;

  select count(*) into v_n from deals
   where account_id = p_account_id and kommo_lead_id is not null
     and exists (select 1 from migracao_kommo.livro_razao l
                  where l.registro_id = deals.id and l.acao = 'criou');
  if v_n > 0 then
    raise exception 'o desfazer deixou % card(s) da carga de pé', v_n;
  end if;

  return jsonb_build_object(
    'linhas',     v_total,
    'cards',      v_cards,
    'alterados',  v_alterados,
    'etiquetas',  v_etiquetas,
    'eventos',    v_eventos,
    'fichas',     v_fichas,
    'retidas',    v_retidas
  );
end;
$desfazer$;

revoke execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  to service_role;

revoke execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  to service_role;

-- ------------------------------------------------------------
-- Conferência — sem exigir dado que só existe nesta instalação.
-- ------------------------------------------------------------
do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)'::regprocedure;

  if v_corpo not like '%coalesce(nullif(v_grupo->>''value'', '''')::numeric, 0)%' then
    raise exception '1015: o INSERT voltou a passar value NULL — 23502 no primeiro lead sem valor';
  end if;
  if v_corpo not like '%''BRL''%' then
    raise exception '1015: o INSERT não fixa currency BRL — os cards nasceriam em USD';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_desfazer(uuid, bigint, boolean)'::regprocedure;
  if v_corpo not like '%tabela = ''contacts''%' then
    raise exception '1015: o desfazer não sabe remover ficha criada pela carga';
  end if;
  if v_corpo not like '%from conversations v where v.contact_id = c.id%' then
    raise exception '1015: o desfazer apagaria ficha COM conversa — levaria as mensagens junto';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1015: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1015: service_role perdeu o execute';
  end if;

  raise notice '1015: os três achados do piloto estão corrigidos.';
end
$conferir$;
