-- ============================================================
-- 1026 — A entrada do lote da Kommo trata "" como ausente.
--
-- Achado do Codex no PR #241, sobre a 1025: as guardas de entrada testavam
-- `(v_evento->>'x') is null`, mas a gravação converte o texto vazio em NULL
-- (`nullif(..., '')`). Um `from_stage_id: ""` — ou qualquer outro id em
-- branco — passava na entrada, o modo de conferência (`p_conferir`) dizia
-- que o lote era válido, e só a conferência de saída o recusava: depois de
-- escrever todos os cards e eventos (desfeitos pela transação) e sem dizer
-- qual lead. Agora toda guarda da entrada aplica a mesma normalização e
-- recusa na hora, nomeando o lead.
--
-- O padrão já existia antes da 1025 (`to_pipeline_id`, `to_stage_id`); a
-- correção cobre todas as guardas de uma vez. A 1025 já estava aplicada,
-- por isso é uma migration nova e não uma edição da 1025.
--
-- O corpo parte da definição VIGENTE (lote da 1025); só a entrada muda.
-- ============================================================

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
  v_contatos    uuid[] := '{}';
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

    if nullif(v_grupo->>'deal_id', '') is not null then
      if not exists (select 1 from deals d
                      where d.id = (v_grupo->>'deal_id')::uuid
                        and d.account_id = p_account_id
                        and d.contact_id = v_contato) then
        raise exception 'lead %: o card % a mover não é desta conta ou não é do contato %',
          v_lead, v_grupo->>'deal_id', v_contato;
      end if;
    end if;

    for v_tag in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_grupo->'etiquetas', '[]'::jsonb)) loop
      if not exists (select 1 from tags t where t.id = v_tag and t.account_id = p_account_id) then
        raise exception 'lead %: etiqueta % não é desta conta', v_lead, v_tag;
      end if;
    end loop;

    for v_evento in select * from jsonb_array_elements(coalesce(v_grupo->'eventos', '[]'::jsonb)) loop
      -- ⚠️ `nullif(..., '')` em TODA guarda desta entrada (1026, Codex no
      -- #241): a gravação lá embaixo converte "" em NULL, então um id em
      -- branco passava aqui, o modo de conferência dizia "lote válido", e só
      -- a conferência de saída o recusava — depois de escrever tudo e sem
      -- dizer qual lead. Aqui ele é recusado antes, nomeando o lead.
      if nullif(v_evento->>'occurred_at', '') is null then
        raise exception 'lead %: evento sem occurred_at (%)', v_lead, v_evento;
      end if;
      case v_evento->>'event_type'
        when 'deal_created' then
          if nullif(v_evento->>'to_pipeline_id', '') is null then
            raise exception 'lead %: deal_created exige to_pipeline_id', v_lead;
          end if;
        when 'stage_changed' then
          if nullif(v_evento->>'to_stage_id', '') is null then
            raise exception 'lead %: stage_changed exige to_stage_id', v_lead;
          end if;
          -- ⚠️⚠️ E EXIGE O FUNIL TAMBÉM (Codex, PR #232). O CHECK da tabela
          -- aceita a linha sem ele e a conferência de pós-voo também passa
          -- (ela só quer ALGUM destino) — mas `cb_funil_trajetorias` lê a
          -- história por `to_pipeline_id`, então o movimento entra no banco,
          -- aparece na aba Histórico da ficha e SOME das três vistas do
          -- funil. Duas telas discordando, sem erro em lugar nenhum.
          if nullif(v_evento->>'to_pipeline_id', '') is null then
            raise exception 'lead %: stage_changed exige to_pipeline_id — sem ele o movimento some do funil (regra 13)', v_lead;
          end if;
        when 'pipeline_changed' then
          if nullif(v_evento->>'from_pipeline_id', '') is null or nullif(v_evento->>'to_pipeline_id', '') is null then
            raise exception 'lead %: pipeline_changed exige from_pipeline_id E to_pipeline_id', v_lead;
          end if;
          if nullif(v_evento->>'from_pipeline_id', '') = nullif(v_evento->>'to_pipeline_id', '') then
            raise exception 'lead %: pipeline_changed com os dois funis iguais', v_lead;
          end if;
          -- ⚠️ E AS DUAS ETAPAS (1025, Codex no #232), cada uma por um motivo.
          -- A de DESTINO é o que `cb_funil_trajetorias` lê como `etapa`: sem
          -- ela o passo sai com `etapa = null`, que `fatosDoNegocio` pula, e a
          -- transferência some das métricas do funil. A de ORIGEM não entra
          -- no funil, mas é o rótulo "Transferido de …" da aba Histórico e o
          -- que a guarda de apagar etapa mapeada consulta (regra 14). O
          -- gatilho da 912 grava as duas neste evento. (Medido na carga de
          -- 21/09: os 1.509 eventos têm as duas.)
          if nullif(v_evento->>'to_stage_id', '') is null then
            raise exception 'lead %: pipeline_changed exige to_stage_id — sem a etapa de destino a transferência some do funil', v_lead;
          end if;
          if nullif(v_evento->>'from_stage_id', '') is null then
            raise exception 'lead %: pipeline_changed exige from_stage_id — sem ela a ficha diria "Transferido de … (—)" (regra 14)', v_lead;
          end if;
        when 'status_changed' then
          if nullif(v_evento->>'to_status', '') is null then
            raise exception 'lead %: status_changed exige to_status', v_lead;
          end if;
          -- ⚠️ E o FUNIL (Codex, PR #232). A conferência de pós-voo cobra
          -- `to_pipeline_id` de TODO evento retroativo — é o que
          -- `cb_funil_trajetorias` lê, e o gatilho da 912 sempre o grava no
          -- `status_changed`. Aceitar o evento aqui e recusá-lo lá derrubava o
          -- lote inteiro DEPOIS de escrever, com uma mensagem que não dizia
          -- qual lead. Na entrada, o lote nem começa e o erro nomeia o lead.
          if nullif(v_evento->>'to_pipeline_id', '') is null then
            raise exception 'lead %: status_changed exige to_pipeline_id — sem ele o evento some do funil (regra 13)', v_lead;
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
    v_contatos := v_contatos || v_contato;

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
        coalesce(nullif(v_grupo->>'value', '')::numeric, 0),
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
      -- ⚠️ TRAVADO (Codex, PR #232): sem o FOR UPDATE, quem mexesse no card
      -- entre esta leitura e o UPDATE abaixo teria o trabalho apagado, e o
      -- livro guardaria como "antes" uma foto que não é a que foi
      -- sobrescrita — o desfazer devolveria o card a um estado que nunca
      -- existiu. Travado, a foto é exatamente o que o UPDATE substitui.
      select to_jsonb(d) into v_antes
        from deals d where d.id = v_card and d.account_id = p_account_id
         for update of d;
      if v_antes is null then
        v_pulados := v_pulados || jsonb_build_object('kommo_lead_id', v_lead, 'motivo', 'card_sumiu');
        continue;
      end if;

      update deals
         set pipeline_id   = v_funil,
             stage_id      = v_etapa,
             status        = v_status,
             kommo_lead_id = v_lead,
             title         = coalesce(nullif(v_grupo->>'title', ''), title),
             created_at    = coalesce((v_grupo->>'created_at')::timestamptz, created_at),
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
        from_pipeline_id, to_pipeline_id, from_stage_id, to_stage_id, to_status, details,
        from_pipeline_label, to_pipeline_label,
        from_stage_label, to_stage_label,
        from_stage_position, to_stage_position,
        contact_label
      ) values (
        p_account_id, v_contato, v_card,
        v_evento->>'event_type', 'retroativo', true,
        (v_evento->>'occurred_at')::timestamptz,
        nullif(v_evento->>'from_pipeline_id', '')::uuid,
        nullif(v_evento->>'to_pipeline_id', '')::uuid,
        nullif(v_evento->>'from_stage_id', '')::uuid,
        nullif(v_evento->>'to_stage_id', '')::uuid,
        nullif(v_evento->>'to_status', ''),
        jsonb_build_object('kommo_lead_id', coalesce((v_evento->>'kommo_lead_id')::bigint, v_lead)),
        (select p.name from pipelines p where p.id = nullif(v_evento->>'from_pipeline_id', '')::uuid),
        (select p.name from pipelines p where p.id = nullif(v_evento->>'to_pipeline_id', '')::uuid),
        (select s.name from pipeline_stages s where s.id = nullif(v_evento->>'from_stage_id', '')::uuid),
        (select s.name from pipeline_stages s where s.id = nullif(v_evento->>'to_stage_id', '')::uuid),
        (select s.position from pipeline_stages s where s.id = nullif(v_evento->>'from_stage_id', '')::uuid),
        (select s.position from pipeline_stages s where s.id = nullif(v_evento->>'to_stage_id', '')::uuid),
        (select c.name from contacts c where c.id = v_contato)
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

  -- ⚠️ A conferência de pós-voo agora cobra o FUNIL, e não "algum destino":
  -- era ela que deixava o `stage_changed` sem funil passar verde.
  select count(*) into v_n
    from cb_lead_events e
   where e.account_id = p_account_id and e.origin = 'retroativo'
     and e.contact_id = any (v_contatos)
     and e.to_pipeline_id is null;
  if v_n > 0 then
    raise exception 'o lote deixou % evento(s) retroativo(s) sem funil de destino — sumiriam do funil', v_n;
  end if;

  select count(*) into v_n
    from cb_lead_events e
   where e.account_id = p_account_id and e.origin = 'retroativo'
     and e.contact_id = any (v_contatos)
     and e.event_type = 'pipeline_changed'
     and (e.from_stage_id is null or e.to_stage_id is null);
  if v_n > 0 then
    raise exception 'o lote deixou % troca(s) de funil sem etapa de origem ou de destino', v_n;
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

revoke execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  to service_role;

do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)'::regprocedure;
  -- a entrada normaliza o texto vazio em TODA guarda
  if v_corpo like '%(v_evento->>''to_stage_id'') is null%'
     or v_corpo like '%(v_evento->>''from_stage_id'') is null%'
     or v_corpo like '%(v_evento->>''to_pipeline_id'') is null%'
     or v_corpo not like '%nullif(v_evento->>''from_stage_id'', '''') is null%'
     or v_corpo not like '%nullif(v_evento->>''to_stage_id'', '''') is null%'
     or v_corpo not like '%nullif(v_evento->>''to_pipeline_id'', '''') is null%' then
    raise exception '1026: uma guarda da entrada voltou a aceitar id em branco';
  end if;
  -- o que a 1017/1019/1023/1025 trouxe continua de pé
  if v_corpo not like '%pipeline_changed exige to_stage_id%'
     or v_corpo not like '%pipeline_changed exige from_stage_id%'
     or v_corpo not like '%troca(s) de funil sem etapa de origem ou de destino%'
     or v_corpo not like '%status_changed exige to_pipeline_id%'
     or v_corpo not like '%stage_changed exige to_pipeline_id%'
     or v_corpo not like '%e.to_pipeline_id is null%'
     or v_corpo not like '%to_stage_label%'
     or v_corpo not like '%d.contact_id = v_contato%'
     or v_corpo not like '%for update of d%' then
    raise exception '1026: o lote perdeu uma guarda da 1017/1019/1023/1025';
  end if;
  if has_function_privilege('anon', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1026: o lote ficou executável pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1026: service_role perdeu o execute do lote';
  end if;
  raise notice '1026: a entrada do lote trata texto vazio como ausente.';
end
$conferir$;
