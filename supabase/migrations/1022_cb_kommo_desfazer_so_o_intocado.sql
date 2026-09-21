-- ============================================================
-- 1022 — O desfazer da carga só devolve o que continua INTOCADO.
--
-- Três rodadas de revisão do Codex no PR #232 apontaram, uma a uma, ramos do
-- desfazer que devolviam a foto de antes POR CIMA de trabalho feito depois:
-- o card movido que o operador arrastou de novo, o valor de campo que alguém
-- editou. A família inteira é fechada aqui, não só os dois pontos apontados:
--
--   deals / criou ........ só apaga o card que ninguém tocou depois
--   deals / alterou ...... só devolve o card movido que continua como a carga o deixou
--   deals / titulo ....... só devolve o título se ninguém mexeu no card
--   contacts / alterou ... só devolve nome/e-mail se a ficha não mudou depois
--   contact_custom_values  só apaga o valor que CONTINUA sendo o da carga
--
-- O que foi trabalhado depois FICA no livro (`v_presas`, a regra da 1017 que
-- mantém a linha que não pôde ser desfeita) e sai reportado em
-- `editadas_depois` — para decisão de gente, nunca apagado em silêncio.
--
-- ⚠️ "Intocado" é medido pelo relógio do banco:
--   · `deals`: a carga gravou `updated_at` com a data da KOMMO (no passado);
--     qualquer escrita posterior passa pelo `set_updated_at` e o empurra para
--     depois de `criado_em` da linha do livro.
--   · `contacts`: a carga escreveu com os gatilhos LIGADOS, então `updated_at`
--     ficou igual a `criado_em` (mesma transação).
--   · `contact_custom_values` não tem `updated_at`: a prova é o VALOR, que o
--     livro passa a guardar. As 5.691 linhas já existentes são preenchidas
--     aqui com o valor de agora — a carga rodou horas atrás, e uma edição
--     feita nesse meio vira "o valor da carga" (o desfazer a apagaria). É o
--     preço de não ter guardado o valor desde o início, escrito.
--
-- E um P1 do mesmo PR, no módulo TS: `src/lib/migracao/pessoas.ts` aceitava
-- telefone de 8–9 dígitos como "criar", e a função no banco exige 10 — um só
-- derrubava o lote inteiro. Consertado no módulo, com teste; o `carga.py` já
-- barrava, então a carga de 21/09 não tropeçou.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `cb_kommo_carregar_pessoas` — o corpo da 1020, com o valor do campo no
-- livro.
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
                -- ⚠️ O VALOR gravado vai junto (Codex, PR #232): é o que deixa o
                -- desfazer distinguir "o valor da carga" de "um valor que alguém
                -- escreveu depois" — a tabela não tem `updated_at`.
                jsonb_build_object('custom_field_id', v_campo, 'field_key', v_par.chave,
                                   'valor', btrim(v_par.valor)));
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
  v_intocado  boolean;
  v_editadas  int := 0;
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
  -- NOMINAL, nunca `user`: o espelho de e-mail (1000/1001) é gatilho de
  -- `contacts` e tem de continuar ligado para limpar o campo espelhado quando
  -- o e-mail volta ao valor de antes.
  alter table public.contacts     disable trigger set_updated_at;

  for v_linha in
    select * from migracao_kommo.livro_razao
     where account_id = p_account_id
       and (p_desde_id is null or id >= p_desde_id)
     order by id desc
  loop
    if v_linha.tabela = 'deals' and v_linha.acao = 'criou' then
      -- ⚠️⚠️ SÓ sai o card INTOCADO desde a carga (Codex, PR #232). A carga
      -- gravou `updated_at` com a data da KOMMO (no passado), e qualquer
      -- escrita depois — alguém arrastou o card, trocou o título, o gatilho
      -- da 1007 seguiu um nome novo — passa pelo `set_updated_at` e o empurra
      -- para depois de `criado_em` da linha do livro. Card trabalhado depois
      -- da carga NÃO é apagado: fica no livro, reportado, para decisão de
      -- gente. Apagar levaria o trabalho junto, sem aviso.
      select d.updated_at <= v_linha.criado_em into v_intocado
        from deals d where d.id = v_linha.registro_id and d.account_id = p_account_id;
      if v_intocado is false then
        v_retidas := v_retidas || jsonb_build_object('deal_id', v_linha.registro_id, 'motivo', 'editado_depois');
        v_presas := v_presas || v_linha.id;
        v_editadas := v_editadas + 1;
      else
        delete from cb_lead_events
         where account_id = p_account_id and deal_id = v_linha.registro_id;
        get diagnostics v_n = row_count; v_eventos := v_eventos + v_n;

        delete from deals
         where id = v_linha.registro_id and account_id = p_account_id;
        get diagnostics v_n = row_count; v_cards := v_cards + v_n;
      end if;

    elsif v_linha.tabela = 'deals' and v_linha.acao = 'alterou'
          and coalesce(v_linha.detalhe->>'o_que', '') = 'titulo' then
      -- O gatilho da 1007 mexeu no título por causa do nome da ficha. Só o
      -- título e a hora voltam: etapa, funil e status nunca foram tocados
      -- aqui, e a trilha deste card não é da carga.
      -- Só volta se ninguém mexeu no card depois (a troca de título pela
      -- carga foi feita com os gatilhos de `deals` calados, então não mudou
      -- `updated_at`; qualquer escrita posterior mudou).
      update deals d
         set title      = v_linha.antes->>'title',
             updated_at = (v_linha.antes->>'updated_at')::timestamptz
       where d.id = v_linha.registro_id and d.account_id = p_account_id
         and d.updated_at <= v_linha.criado_em;
      get diagnostics v_n = row_count;
      if v_n = 0 and exists (select 1 from deals where id = v_linha.registro_id) then
        v_retidas := v_retidas || jsonb_build_object('deal_id', v_linha.registro_id, 'motivo', 'editado_depois');
        v_presas := v_presas || v_linha.id;
        v_editadas := v_editadas + 1;
      else
        v_titulos := v_titulos + v_n;
      end if;

    elsif v_linha.tabela = 'deals' and v_linha.acao = 'alterou' then
      -- ⚠️⚠️ O card MOVIDO só volta se continua como a carga o deixou (Codex,
      -- PR #232). Se o operador o moveu ou editou depois, devolver o esboço de
      -- antes da carga apagaria esse trabalho em silêncio.
      select d.updated_at <= v_linha.criado_em into v_intocado
        from deals d where d.id = v_linha.registro_id and d.account_id = p_account_id;
      if v_intocado is false then
        v_retidas := v_retidas || jsonb_build_object('deal_id', v_linha.registro_id, 'motivo', 'editado_depois');
        v_presas := v_presas || v_linha.id;
        v_editadas := v_editadas + 1;
        continue;
      end if;

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
      -- ⚠️⚠️ Só sai o valor que CONTINUA sendo o da carga (Codex, PR #232).
      -- A tabela não tem `updated_at`, então a prova é o próprio valor, que o
      -- livro guarda desde a 1022 (e que a 1022 preencheu nas linhas que já
      -- existiam). Valor editado depois — por gente ou por automação — FICA.
      -- Linha sem o valor registrado também fica: sem prova, não se apaga.
      delete from contact_custom_values v
       where v.contact_id = v_linha.registro_id
         and v.custom_field_id = (v_linha.detalhe->>'custom_field_id')::uuid
         and v_linha.detalhe ? 'valor'
         and v.value is not distinct from v_linha.detalhe->>'valor';
      get diagnostics v_n = row_count;
      if v_n = 0 and exists (select 1 from contact_custom_values
                              where contact_id = v_linha.registro_id
                                and custom_field_id = (v_linha.detalhe->>'custom_field_id')::uuid) then
        v_retidas := v_retidas || jsonb_build_object('contact_id', v_linha.registro_id,
                                                     'field_key', v_linha.detalhe->>'field_key',
                                                     'motivo', 'editado_depois');
        v_presas := v_presas || v_linha.id;
        v_editadas := v_editadas + 1;
      else
        v_valores := v_valores + v_n;
      end if;

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
      -- Só volta se a ficha continua como a carga a deixou: a carga escreveu
      -- com os gatilhos de `contacts` LIGADOS, então `updated_at` ficou igual
      -- ao `criado_em` da linha do livro (mesma transação). Nome ou e-mail
      -- trocado depois — pela equipe, pelo Calendly, pela ingestão — o
      -- empurrou para a frente, e a ficha fica como está.
      -- ⚠️ `updated_at` volta EXPLICITAMENTE, com o `set_updated_at` de
      -- `contacts` calado (só ele — o espelho de e-mail continua ligado).
      -- Sem isso, devolver o e-mail empurraria `updated_at` para agora, e a
      -- linha seguinte da MESMA ficha (o nome, gravado antes na carga) seria
      -- lida como "editada depois" e ficaria retida por engano.
      update contacts c
         set name           = v_linha.antes->>'name',
             nome_fixado_em = nullif(v_linha.antes->>'nome_fixado_em', '')::timestamptz,
             email          = nullif(v_linha.antes->>'email', ''),
             updated_at     = (v_linha.antes->>'updated_at')::timestamptz
       where c.id = v_linha.registro_id and c.account_id = p_account_id
         and c.updated_at <= v_linha.criado_em;
      get diagnostics v_n = row_count;
      if v_n = 0 and exists (select 1 from contacts where id = v_linha.registro_id) then
        v_retidas := v_retidas || jsonb_build_object('contact_id', v_linha.registro_id, 'motivo', 'editado_depois');
        v_presas := v_presas || v_linha.id;
        v_editadas := v_editadas + 1;
      else
        v_fichas_up := v_fichas_up + v_n;
      end if;

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
  alter table public.contacts     enable trigger set_updated_at;

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
    'editadas_depois', v_editadas,
    'retidas',    v_retidas);
end;
$desfazer$;


-- ------------------------------------------------------------
-- 3. O valor nas linhas do livro que JÁ existem (a carga de 21/09).
-- Em banco novo não há linha nenhuma: no-op.
-- ------------------------------------------------------------
update migracao_kommo.livro_razao l
   set detalhe = l.detalhe || jsonb_build_object('valor', v.value)
  from contact_custom_values v
 where l.tabela = 'contact_custom_values'
   and l.acao = 'criou'
   and not (l.detalhe ? 'valor')
   and v.contact_id = l.registro_id
   and v.custom_field_id = (l.detalhe->>'custom_field_id')::uuid;

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
  v_sem_valor int;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_desfazer(uuid, bigint, boolean)'::regprocedure;
  if v_corpo not like '%d.updated_at <= v_linha.criado_em%' then
    raise exception '1022: o desfazer voltou a devolver card por cima de edição posterior';
  end if;
  if v_corpo not like '%v.value is not distinct from v_linha.detalhe->>''valor''%' then
    raise exception '1022: o desfazer voltou a apagar valor de campo editado depois';
  end if;
  if v_corpo not like '%c.updated_at <= v_linha.criado_em%' then
    raise exception '1022: o desfazer voltou a devolver ficha por cima de edição posterior';
  end if;
  if v_corpo not like '%disable trigger set_updated_at%' or v_corpo like '%contacts     disable trigger user%' then
    raise exception '1022: o desfazer tem de calar SÓ o set_updated_at de contacts (o espelho de e-mail fica ligado)';
  end if;
  if v_corpo not like '%not (id = any (v_presas))%' then
    raise exception '1022: a linha retida voltou a sair do livro — o desfazer deixaria de ser repetível';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%''valor'', btrim(v_par.valor)%' then
    raise exception '1022: o valor do campo não vai para o livro — o desfazer não teria prova';
  end if;
  if v_corpo not like '%phone_normalized in (v_telefone, coalesce(v_irma, v_telefone))%'
     or v_corpo not like '%alter table public.deals disable trigger user%' then
    raise exception '1022: a função de pessoas perdeu uma guarda da 1017/1020';
  end if;

  -- Toda linha de campo do livro tem de ter o valor (a de banco novo: zero linhas).
  select count(*) into v_sem_valor
    from migracao_kommo.livro_razao l
   where l.tabela = 'contact_custom_values' and l.acao = 'criou'
     and not (l.detalhe ? 'valor')
     and exists (select 1 from contact_custom_values v
                  where v.contact_id = l.registro_id
                    and v.custom_field_id = (l.detalhe->>'custom_field_id')::uuid);
  if v_sem_valor > 0 then
    raise exception '1022: % linha(s) de campo ficaram sem o valor no livro', v_sem_valor;
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1022: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1022: service_role perdeu o execute';
  end if;

  raise notice '1022: o desfazer só devolve o que continua intocado desde a carga.';
end
$conferir$;
