-- ============================================================
-- 1017 — Os achados da revisão adversarial da carga (21/09/2026).
--
-- A 1016 foi ensaiada contra a produção e voltou ao ponto exato. Cinco lentes
-- de revisão sobre ela e sobre o carregador levantaram 18 achados, 15
-- confirmados por um segundo leitor que tentou derrubá-los no arquivo. Os que
-- moram no BANCO estão aqui; os que moram no carregador foram corrigidos lá.
--
--  1. ⚠️⚠️ **P0 — a carga nunca olhava `deals`.** A decisão 11 do plano ("a
--     etapa da Kommo MOVE o card dos que já existem aqui") tinha o ramo de
--     UPDATE pronto na 1014, atrás do campo `deal_id`, e NINGUÉM o alimentava.
--     Medido: das 4.635 pessoas do recorte, 761 já têm ficha e **562 dessas
--     fichas já têm negócio** — a carga criaria 583 cards por cima, e o Kanban
--     desenharia a mesma pessoa duas vezes, que é exatamente a inflação da
--     Kommo que esta migração existe para desfazer. O conserto é no
--     carregador, mas o ramo de UPDATE precisava de duas colunas que ele não
--     escrevia: `created_at` (senão o card movido guarda a data do CRM
--     enquanto a trilha dele é de 2025, reprovando a conferência 30) e
--     `title`.
--
--  2. ⚠️ **Os 12.308 eventos nasciam MUDOS.** `cb_lead_events` tem seis
--     colunas de rótulo/posição que o gatilho da 912 preenche e que a função
--     deixava nulas. `useLeadEventText` faz `valor ?? '—'`, então a aba
--     Histórico da ficha e do painel leria "Negócio criado em — · —" e
--     "Transferido de — (—) para — (—)" doze mil vezes. Os rótulos são
--     GRAVADOS, e não derivados na leitura, de propósito (regra 13): etapa por
--     onde o lead passou pode ser apagada, e renomear reescreveria o passado.
--
--  3. ⚠️⚠️ **O desfazer apagava do livro as linhas que ele RETEVE.** O DELETE
--     final tinha o mesmo predicado do laço e não excluía `v_retidas`. Quando
--     um cliente manda mensagem durante a carga, a ficha dele não sai (a
--     guarda existe para não levar a conversa junto) — e a linha do livro saía
--     assim mesmo. O segundo desfazer, no dia seguinte, responderia
--     `linhas: 0` sobre uma ficha que continua de pé, já despida de etiqueta e
--     campo. O desfazer deixava de ser repetível, que é a única coisa que ele
--     tem de ser.
--
--  4. ⚠️ **O gatilho do título escrevia em `deals` no passo de PESSOAS.**
--     `cb_titulo_do_card_segue_a_ficha` (1007) é AFTER UPDATE OF name em
--     `contacts` e faz `UPDATE deals SET title`; `set_updated_at` de `deals` é
--     BEFORE UPDATE sem lista de colunas e carimba `now()`. A 1016 dizia que a
--     ordem "pessoas antes dos cards" resolvia — e resolve para o card que a
--     carga vai CRIAR, não para os ~962 que já existem. Agora a função de
--     pessoas silencia `deals` (só `deals`: o espelho de e-mail é gatilho de
--     `contacts`/`contact_custom_values` e continua ligado) e registra no
--     livro o card cujo título o gatilho vai mexer.
--
--  5. ⚠️ A conferência de pós-voo da regra 18 varria a CONTA inteira: uma
--     ficha alheia com separador — criada por qualquer outro caminho —
--     derrubaria todo lote seguinte, sem que o lote tivesse culpa.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `cb_kommo_carregar_lote` — move o card que já existe, narra a trilha.
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

    -- ⚠️ O card a MOVER (decisão 11) tem de ser desta conta e do MESMO
    -- contato: sem esta cerca, um `deal_id` trocado no payload mudaria o
    -- negócio de outro cliente de funil, de etapa e de status.
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
      -- ⚠️⚠️ DECISÃO 11: o card que já existe aqui é um esboço criado pela
      -- conexão, e a etapa VERDADEIRA está na Kommo. Ele é MOVIDO, não
      -- duplicado. O `antes` guarda a linha inteira — título e data de
      -- nascimento inclusive —, porque agora os dois são reescritos.
      select to_jsonb(d) into v_antes
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
             title         = coalesce(nullif(v_grupo->>'title', ''), title),
             -- ⚠️ `created_at` da Kommo também no card MOVIDO: sem ele, o card
             -- guarda a data em que a CONEXÃO o criou (2026) enquanto a trilha
             -- que a carga escreve para ele começa em 2025 — e a conferência
             -- 30 do contrato ("min(occurred_at) por card = deals.created_at")
             -- reprovaria em todos os 562.
             created_at    = coalesce((v_grupo->>'created_at')::timestamptz, created_at),
             updated_at    = coalesce((v_grupo->>'updated_at')::timestamptz, updated_at),
             value         = coalesce(nullif(v_grupo->>'value', '')::numeric, value)
       where id = v_card and account_id = p_account_id;

      insert into migracao_kommo.livro_razao (account_id, kommo_lead_id, acao, tabela, registro_id, antes)
      values (p_account_id, v_lead, 'alterou', 'deals', v_card, v_antes);
      v_movidos := v_movidos + 1;
    end if;

    for v_evento in select * from jsonb_array_elements(coalesce(v_grupo->'eventos', '[]'::jsonb)) loop
      -- ⚠️ Os RÓTULOS e as POSIÇÕES são GRAVADOS, não derivados na leitura
      -- (regra 13): a etapa por onde o lead passou pode ser apagada, e
      -- renomeá-la reescreveria o passado em silêncio. Sem eles,
      -- `useLeadEventText` cai no `?? '—'` e a aba Histórico lê
      -- "Transferido de — (—) para — (—)".
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

  -- ⚠️ As duas conferências de pós-voo são sobre OS CONTATOS DO LOTE, não
  -- sobre a conta: card órfão alheio (ou uma linha criada por outro caminho)
  -- derrubaria o lote seguinte sem que ele tivesse culpa, e a carga pararia
  -- no meio por causa de sujeira que não é dela.
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
     and e.contact_id = any (v_contatos)
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
-- 2. `cb_kommo_carregar_pessoas` — silencia `deals` e registra o título.
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
         where account_id = p_account_id and phone_normalized = v_telefone;
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
-- 3. `cb_kommo_desfazer` — não apaga do livro o que não conseguiu desfazer.
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
  v_titulos   int := 0;
  v_etiquetas int := 0;
  v_eventos   int := 0;
  v_fichas    int := 0;
  v_fichas_up int := 0;
  v_valores   int := 0;
  v_conversas int := 0;
  v_notas     int := 0;
  v_tags      int := 0;
  v_retidas   jsonb := '[]'::jsonb;
  v_presas    bigint[] := '{}';
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

    elsif v_linha.tabela = 'deals' and v_linha.acao = 'alterou'
          and coalesce(v_linha.detalhe->>'o_que', '') = 'titulo' then
      -- O gatilho da 1007 mexeu no título por causa do nome da ficha. Só o
      -- título e a hora voltam: etapa, funil e status nunca foram tocados
      -- aqui, e a trilha deste card não é da carga.
      update deals d
         set title      = v_linha.antes->>'title',
             updated_at = (v_linha.antes->>'updated_at')::timestamptz
       where d.id = v_linha.registro_id and d.account_id = p_account_id;
      get diagnostics v_n = row_count; v_titulos := v_titulos + v_n;

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
             title         = v_linha.antes->>'title',
             value         = coalesce(nullif(v_linha.antes->>'value', '')::numeric, 0),
             currency      = nullif(v_linha.antes->>'currency', ''),
             kommo_lead_id = nullif(v_linha.antes->>'kommo_lead_id', '')::bigint,
             created_at    = (v_linha.antes->>'created_at')::timestamptz,
             updated_at    = (v_linha.antes->>'updated_at')::timestamptz
       where d.id = v_linha.registro_id and d.account_id = p_account_id;
      get diagnostics v_n = row_count; v_alterados := v_alterados + v_n;

    elsif v_linha.tabela = 'contact_tags' and v_linha.acao = 'criou' then
      delete from contact_tags
       where contact_id = v_linha.registro_id
         and tag_id = (v_linha.detalhe->>'tag_id')::uuid;
      get diagnostics v_n = row_count; v_etiquetas := v_etiquetas + v_n;

    elsif v_linha.tabela = 'cb_conversation_notes' and v_linha.acao = 'criou' then
      delete from cb_conversation_notes
       where id = v_linha.registro_id and account_id = p_account_id;
      get diagnostics v_n = row_count; v_notas := v_notas + v_n;

    elsif v_linha.tabela = 'contact_custom_values' and v_linha.acao = 'criou' then
      delete from contact_custom_values
       where contact_id = v_linha.registro_id
         and custom_field_id = (v_linha.detalhe->>'custom_field_id')::uuid;
      get diagnostics v_n = row_count; v_valores := v_valores + v_n;

    elsif v_linha.tabela = 'conversations' and v_linha.acao = 'criou' then
      delete from conversations c
       where c.id = v_linha.registro_id
         and c.account_id = p_account_id
         and not exists (select 1 from messages m where m.conversation_id = c.id)
         and not exists (select 1 from cb_conversation_notes n where n.conversation_id = c.id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        v_retidas := v_retidas || jsonb_build_object('conversation_id', v_linha.registro_id);
        v_presas := v_presas || v_linha.id;
      else
        v_conversas := v_conversas + v_n;
      end if;

    elsif v_linha.tabela = 'tags' and v_linha.acao = 'criou' then
      delete from tags t
       where t.id = v_linha.registro_id
         and t.account_id = p_account_id
         and not exists (select 1 from contact_tags ct where ct.tag_id = t.id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        v_retidas := v_retidas || jsonb_build_object('tag_id', v_linha.registro_id);
        v_presas := v_presas || v_linha.id;
      else
        v_tags := v_tags + v_n;
      end if;

    elsif v_linha.tabela = 'contacts' and v_linha.acao = 'alterou' then
      update contacts c
         set name           = v_linha.antes->>'name',
             nome_fixado_em = nullif(v_linha.antes->>'nome_fixado_em', '')::timestamptz,
             email          = nullif(v_linha.antes->>'email', '')
       where c.id = v_linha.registro_id and c.account_id = p_account_id;
      get diagnostics v_n = row_count; v_fichas_up := v_fichas_up + v_n;

    elsif v_linha.tabela = 'contacts' and v_linha.acao = 'criou' then
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
        v_retidas := v_retidas || jsonb_build_object('contact_id', v_linha.registro_id);
        v_presas := v_presas || v_linha.id;
      else
        v_fichas := v_fichas + v_n;
      end if;

    else
      raise exception 'cb_kommo_desfazer: não sei desfazer % em % (linha %)',
        v_linha.acao, v_linha.tabela, v_linha.id;
    end if;
  end loop;

  -- ⚠️⚠️ A linha RETIDA FICA NO LIVRO. O objeto não saiu — quase sempre porque
  -- o cliente escreveu durante a carga e a ficha ganhou conversa —, e apagar o
  -- registro tira a única prova de que aquela ficha foi criada pela migração.
  -- O desfazer tem de ser REPETÍVEL: depois de a mensagem ser tratada, rodar
  -- de novo tem de terminar o serviço. Até 21/09 o DELETE tinha o mesmo
  -- predicado do laço e levava a retida junto — a segunda tentativa respondia
  -- "linhas: 0" sobre uma ficha que continuava de pé.
  delete from migracao_kommo.livro_razao
   where account_id = p_account_id
     and (p_desde_id is null or id >= p_desde_id)
     and not (id = any (v_presas));

  alter table public.deals        enable trigger user;
  alter table public.contact_tags enable trigger user;

  return jsonb_build_object(
    'linhas',     v_total,
    'cards',      v_cards,
    'alterados',  v_alterados,
    'titulos',    v_titulos,
    'etiquetas',  v_etiquetas,
    'eventos',    v_eventos,
    'fichas',     v_fichas,
    'fichas_revertidas', v_fichas_up,
    'valores',    v_valores,
    'conversas',  v_conversas,
    'notas',      v_notas,
    'tags',       v_tags,
    'presas_no_livro', coalesce(array_length(v_presas, 1), 0),
    'retidas',    v_retidas);
end;
$desfazer$;

revoke execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  to service_role;
revoke execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  to service_role;
revoke execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  to service_role;

do $conferir$
declare
  v_corpo text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%to_stage_label%' or v_corpo not like '%to_stage_position%' then
    raise exception '1017: a trilha volta a nascer muda — a aba Histórico leria "Mudou de — para —"';
  end if;
  if v_corpo not like '%created_at    = coalesce((v_grupo->>''created_at'')::timestamptz, created_at)%' then
    raise exception '1017: o card MOVIDO não recebe o created_at da Kommo — a conferência 30 reprovaria';
  end if;
  if v_corpo not like '%d.contact_id = v_contato%' then
    raise exception '1017: o card a mover não é conferido contra o contato — mudaria o negócio de outro cliente';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%alter table public.deals disable trigger user%' then
    raise exception '1017: a função de pessoas não silencia deals — o gatilho do título carimbaria updated_at';
  end if;
  if v_corpo like '%contact_custom_values disable%' or v_corpo like '%contacts disable%' then
    raise exception '1017: a função de pessoas silenciou o espelho de e-mail (1000/1001)';
  end if;
  if v_corpo not like '%fixar_nome%' then
    raise exception '1017: a função de pessoas fixa nome sem quem chamou autorizar — rótulo automático viraria nome eterno';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_desfazer(uuid, bigint, boolean)'::regprocedure;
  if v_corpo not like '%not (id = any (v_presas))%' then
    raise exception '1017: o desfazer volta a apagar do livro a linha que ele reteve — deixa de ser repetível';
  end if;
  if v_corpo not like '%''o_que'', '''') = ''titulo''%' then
    raise exception '1017: o desfazer não sabe devolver o título que o gatilho da 1007 mexeu';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1017: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1017: service_role perdeu o execute';
  end if;

  raise notice '1017: o card que já existe é MOVIDO, a trilha nasce com rótulo, e o desfazer é repetível.';
end
$conferir$;
