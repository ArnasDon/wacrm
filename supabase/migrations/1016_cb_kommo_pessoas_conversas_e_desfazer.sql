-- ============================================================
-- 1016 — O que a 1014/1015 deixou de fora: PESSOA, CONVERSA e ANOTAÇÃO.
--
-- A 1015 fechou a função de LOTE (card + trilha + etiqueta). O piloto rodou
-- com ela e provou a mecânica, mas a carga de verdade escreve mais cinco
-- coisas, e as cinco estavam fora do livro-razão — ou seja, FORA DO DESFAZER:
--
--   contato criado · nome fixado · e-mail · campo personalizado ·
--   conversa encerrada · anotação
--
-- O piloto já tinha mostrado o preço disso em miniatura: a ficha nascia por um
-- INSERT solto e sobraram 24 contatos órfãos que nenhum desfazer alcançava
-- (achado 3 da 1015). A correção de lá foi pontual — a CTE que grava a ficha
-- no livro na mesma instrução. Esta migration generaliza: TODA escrita da
-- carga passa a ter uma função que a registra, e o desfazer passa a conhecer
-- as cinco tabelas novas.
--
-- ⚠️⚠️ POR QUE ESTAS DUAS FUNÇÕES **NÃO** DESLIGAM GATILHO — e a de lote sim.
-- É o inverso do caso dos cards, e por um motivo escrito na 1014: aqui os
-- gatilhos são o MECANISMO, não o estorvo.
--   · `cb_email_da_ficha_para_o_campo` (1000/1001) é quem cria o valor do
--     campo espelhado a partir de `contacts.email`. Silenciado, os e-mails
--     entrariam sem espelho e `{{contact.campo.email}}` ficaria vazio.
--   · `cb_titulo_do_card_segue_a_ficha` (1007) é quem troca o telefone pelo
--     nome no título do card.
--   · `contacts` não tem gatilho de trilha nem de fila de automação — não há
--     o que reparar depois.
--
-- ⚠️⚠️ E DAÍ SAI UMA ORDEM OBRIGATÓRIA NA CARGA: **pessoas ANTES dos cards.**
-- `cb_titulo_do_card_segue_a_ficha_trigger` é `AFTER UPDATE OF name` e escreve
-- em `deals`; `set_updated_at` de `deals` é BEFORE UPDATE **sem lista de
-- colunas**. Trocar o nome de uma ficha DEPOIS de o card dela existir carimba
-- `updated_at = now()` naquele card — e o cabeçalho do Kanban conta
-- "ganhos/perdidos este mês" por essa coluna (regra 8 do contrato). Rodando
-- as pessoas primeiro, o gatilho não acha card e não há o que carimbar.
-- (Medido no catálogo em 21/09: o gatilho é `OF name`, então gravar e-mail
-- NÃO o dispara — só o nome.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. `cb_kommo_carregar_pessoas` — ficha, nome, e-mail e campo.
--
-- Recebe o `contact_id` JÁ RESOLVIDO quando a pessoa existe: quem resolve é a
-- carga, pela régua do NONO DÍGITO (`src/lib/migracao/pessoas.ts`), e não esta
-- função — 336 das 1.157 fichas que já existem casam SÓ pela variante, e uma
-- resolução por igualdade de `phone_normalized` criaria ficha nova para elas.
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
  -- ⚠️⚠️ ALLOWLIST EXPLÍCITA (regra 23 do contrato). A carga escreve SÓ
  -- nestas chaves e ABORTA em qualquer outra. `data_e_hora_reuniao` e
  -- `link_reuniao` são do Calendly (106 valores vivos) e não são território
  -- da Kommo; `email` é ESPELHO (1000/1001) e entra por `contacts.email` —
  -- gravar os dois lados dá 23505 e derruba o lote (regra 24).
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
  v_pulados    jsonb := '[]'::jsonb;
  v_inicio     timestamptz := clock_timestamp();
  v_chaves     text[];
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

  -- ---------- conferência de forma, ANTES de escrever ----------
  for v_pessoa in select * from jsonb_array_elements(p_pessoas) loop
    v_telefone := v_pessoa->>'telefone';

    -- ⚠️⚠️ Regra 18: SÓ DÍGITOS. Gravado com separadores, a ficha entra
    -- normalmente e a PRIMEIRA mensagem daquele cliente é descartada em
    -- silêncio — e todas as seguintes, para sempre: a busca não acha a ficha,
    -- o INSERT leva 23505 do índice único parcial, a recuperação falha pelo
    -- mesmo motivo, e a ingestão desiste. O WhatsApp já respondeu 200.
    if v_telefone is null or v_telefone !~ '^[0-9]{10,15}$' then
      raise exception 'pessoa com telefone que não é 10-15 dígitos: % (regra 18)',
        coalesce(v_telefone, '(nulo)');
    end if;

    if (v_pessoa->>'contact_id') is not null
       and not exists (select 1 from contacts c
                        where c.id = (v_pessoa->>'contact_id')::uuid
                          and c.account_id = p_account_id) then
      raise exception 'telefone %: contato % não é desta conta', v_telefone, v_pessoa->>'contact_id';
    end if;

    -- A allowlist, conferida chave a chave.
    select coalesce(array_agg(k), '{}') into v_chaves
      from jsonb_object_keys(coalesce(v_pessoa->'campos', '{}'::jsonb)) k;
    foreach v_nome in array v_chaves loop
      if not (v_nome = any (c_permitidos)) then
        raise exception 'telefone %: campo "%" está fora da allowlist da carga (regra 23)',
          v_telefone, v_nome;
      end if;
      -- Regra 22: resolve por `field_key` e ABORTA se faltar; nunca cria pelo
      -- nome. Criado pelo nome, o valor pousaria numa chave que ninguém lê.
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

  -- ---------- escrita ----------
  for v_pessoa in select * from jsonb_array_elements(p_pessoas) loop
    v_telefone := v_pessoa->>'telefone';
    v_contato  := nullif(v_pessoa->>'contact_id', '')::uuid;
    v_nome     := nullif(btrim(coalesce(v_pessoa->>'nome', '')), '');
    v_email    := nullif(btrim(coalesce(v_pessoa->>'email', '')), '');

    if v_contato is null then
      -- Regra 20: reexecutável. `ON CONFLICT DO NOTHING` + SELECT em seguida,
      -- NUNCA o id do RETURNING — ele vem vazio para quem perde a corrida, e
      -- a carga roda com a ingestão viva.
      insert into contacts (account_id, user_id, name, phone, nome_fixado_em)
      values (p_account_id, v_dono, coalesce(v_nome, v_telefone), v_telefone,
              -- ⚠️ Fixa só NOME DE GENTE. `nomeParaFixar` recusa número, e
              -- fixar "5583…" tiraria da ficha o nome de verdade para sempre.
              case when v_nome is not null and v_nome !~ '^[0-9 ()+-]+$'
                   then now() end)
      on conflict (account_id, phone_normalized) where phone_normalized <> ''
      do nothing
      returning id into v_contato;

      if v_contato is not null then
        insert into migracao_kommo.livro_razao (account_id, acao, tabela, registro_id)
        values (p_account_id, 'criou', 'contacts', v_contato);
        v_criados := v_criados + 1;
      else
        -- Perdeu a corrida (ou a ficha nasceu entre a resolução e aqui).
        select id into v_contato
          from contacts
         where account_id = p_account_id and phone_normalized = v_telefone;
        if v_contato is null then
          v_pulados := v_pulados || jsonb_build_object('telefone', v_telefone, 'motivo', 'sem_ficha');
          continue;
        end if;
      end if;

    else
      -- ---------- NOME, na ficha que já existia ----------
      -- ⚠️ Regra 27: só sobrescreve nome VAZIO ou que é TELEFONE, e só quando
      -- ninguém o fixou à mão. Os 298 já fixados nesta conta não são tocados —
      -- o nome que a equipe lê hoje seria destruído sem cópia.
      if v_nome is not null and v_nome !~ '^[0-9 ()+-]+$' then
        select to_jsonb(c) - 'phone_normalized' into v_antes
          from contacts c
         where c.id = v_contato and c.account_id = p_account_id
           and c.nome_fixado_em is null
           and (c.name is null or btrim(c.name) = '' or btrim(c.name) ~ '^[0-9 ()+-]+$')
           and btrim(c.name) is distinct from v_nome;
        if v_antes is not null then
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

    -- ---------- E-MAIL ----------
    -- ⚠️ Regra 24: SÓ onde está vazio. São 54 e-mails no CRM hoje, os mais
    -- recentes da base (Calendly e Asaas), contra um da Kommo de até 15 meses.
    -- Sobrescrevê-los faria o vínculo automático do tl;dv casar pelo errado.
    -- E entra por `contacts.email`: o gatilho da 1000 cria o valor do campo.
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

    -- ---------- CAMPOS PERSONALIZADOS ----------
    for v_par in
      select key as chave, value #>> '{}' as valor
        from jsonb_each(coalesce(v_pessoa->'campos', '{}'::jsonb))
    loop
      if nullif(btrim(coalesce(v_par.valor, '')), '') is null then
        continue;  -- nunca se grava linha vazia (regra do de-para, seção 11)
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

  -- Conferência de pós-voo da regra 18, sobre a TABELA e não sobre o lote:
  -- telefone com separador em qualquer ficha desta conta é mensagem de cliente
  -- perdida para sempre.
  if exists (select 1 from contacts
              where account_id = p_account_id and phone is not null and phone ~ '[^0-9+]') then
    raise exception 'há ficha com separador no telefone nesta conta — regra 18';
  end if;

  return jsonb_build_object(
    'pessoas',  jsonb_array_length(p_pessoas),
    'criados',  v_criados,
    'nomes',    v_nomes,
    'emails',   v_emails,
    'valores',  v_valores,
    'pulados',  v_pulados,
    'ms',       extract(milliseconds from clock_timestamp() - v_inicio));
end;
$pessoas$;

-- ------------------------------------------------------------
-- 2. `cb_kommo_carregar_conversas` — a conversa ENCERRADA e as anotações.
--
-- A conversa nasce `closed` e sem mensagem: não aparece na aba "Abertas", vai
-- para o fim da lista (sem `last_message_at`) e REABRE SOZINHA quando o
-- cliente escrever — com a anotação já esperando lá dentro (de-para, seção 8).
-- ------------------------------------------------------------
create or replace function public.cb_kommo_carregar_conversas(
  p_account_id uuid,
  p_itens      jsonb,
  p_conferir   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $conversas$
declare
  v_dono      uuid;
  v_item      jsonb;
  v_nota      jsonb;
  v_contato   uuid;
  v_conversa  uuid;
  v_nota_id   uuid;
  v_conversas int := 0;
  v_notas     int := 0;
  v_repetidas int := 0;
  v_inicio    timestamptz := clock_timestamp();
begin
  if p_account_id is null then
    raise exception 'cb_kommo_carregar_conversas: p_account_id é obrigatório';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'cb_kommo_carregar_conversas: p_itens tem de ser um array jsonb (veio %)',
      coalesce(jsonb_typeof(p_itens), 'null');
  end if;

  select owner_user_id into v_dono from accounts where id = p_account_id;
  if v_dono is null then
    raise exception 'cb_kommo_carregar_conversas: conta % está sem owner_user_id', p_account_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_contato := nullif(v_item->>'contact_id', '')::uuid;
    if v_contato is null then
      raise exception 'item sem contact_id: %', v_item;
    end if;
    if not exists (select 1 from contacts c
                    where c.id = v_contato and c.account_id = p_account_id) then
      raise exception 'contato % não é desta conta', v_contato;
    end if;
    for v_nota in select * from jsonb_array_elements(coalesce(v_item->'notas', '[]'::jsonb)) loop
      if nullif(btrim(coalesce(v_nota->>'texto', '')), '') is null then
        raise exception 'contato %: anotação sem texto', v_contato;
      end if;
      if (v_nota->>'created_at') is null then
        raise exception 'contato %: anotação sem created_at', v_contato;
      end if;
    end loop;
  end loop;

  if p_conferir then
    return jsonb_build_object('conferido', jsonb_array_length(p_itens), 'escreveu', false,
                              'ms', extract(milliseconds from clock_timestamp() - v_inicio));
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_contato := (v_item->>'contact_id')::uuid;

    select id into v_conversa from conversations
     where account_id = p_account_id and contact_id = v_contato;

    if v_conversa is null then
      insert into conversations (account_id, user_id, contact_id, status)
      values (p_account_id, v_dono, v_contato, 'closed')
      on conflict (account_id, contact_id) do nothing
      returning id into v_conversa;

      if v_conversa is not null then
        insert into migracao_kommo.livro_razao (account_id, acao, tabela, registro_id)
        values (p_account_id, 'criou', 'conversations', v_conversa);
        v_conversas := v_conversas + 1;
      else
        select id into v_conversa from conversations
         where account_id = p_account_id and contact_id = v_contato;
      end if;
    end if;

    if v_conversa is null then
      raise exception 'contato %: não consegui resolver a conversa', v_contato;
    end if;

    for v_nota in select * from jsonb_array_elements(coalesce(v_item->'notas', '[]'::jsonb)) loop
      -- ⚠️ `cb_conversation_notes` não tem chave única natural, então a
      -- idempotência é esta cerca: mesma conversa, mesmo instante, mesmo
      -- texto. Sem ela, reexecutar a carga duplica a anotação em silêncio —
      -- é a mesma armadilha dos eventos fundidos (de-para, seção 6b).
      if exists (select 1 from cb_conversation_notes n
                  where n.account_id = p_account_id
                    and n.conversation_id = v_conversa
                    and n.created_at = (v_nota->>'created_at')::timestamptz
                    and n.texto = v_nota->>'texto') then
        v_repetidas := v_repetidas + 1;
        continue;
      end if;

      -- ⚠️ `contact_id` preenchido, não só `conversation_id` (regra 25): sem
      -- ele a anotação some da ficha de /contatos — que é onde o advogado vai
      -- procurar o histórico — e não pode ser fixada.
      -- `author_user_id` fica NULO: quem escreveu na Kommo não é membro daqui.
      insert into cb_conversation_notes
             (account_id, conversation_id, contact_id, author_user_id,
              autor_nome, texto, mencionados, created_at)
      values (p_account_id, v_conversa, v_contato, null,
              nullif(btrim(coalesce(v_nota->>'autor_nome', '')), ''),
              v_nota->>'texto', '{}', (v_nota->>'created_at')::timestamptz)
      returning id into v_nota_id;

      insert into migracao_kommo.livro_razao (account_id, acao, tabela, registro_id)
      values (p_account_id, 'criou', 'cb_conversation_notes', v_nota_id);
      v_notas := v_notas + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'itens',      jsonb_array_length(p_itens),
    'conversas',  v_conversas,
    'notas',      v_notas,
    'repetidas',  v_repetidas,
    'ms',         extract(milliseconds from clock_timestamp() - v_inicio));
end;
$conversas$;

-- ------------------------------------------------------------
-- 3. `cb_kommo_desfazer` — agora com as cinco tabelas novas.
--
-- O corpo da 1015 é preservado linha a linha; o que muda são os ramos novos e
-- a ordem, que continua sendo do FIM para o COMEÇO do livro (`order by id
-- desc`) — é ela que garante a receita de fusão do CLAUDE.md: apagar o que
-- aponta antes do que é apontado.
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
  v_fichas_up int := 0;
  v_valores   int := 0;
  v_conversas int := 0;
  v_notas     int := 0;
  v_tags      int := 0;
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

    elsif v_linha.tabela = 'cb_conversation_notes' and v_linha.acao = 'criou' then
      delete from cb_conversation_notes
       where id = v_linha.registro_id and account_id = p_account_id;
      get diagnostics v_n = row_count; v_notas := v_notas + v_n;

    elsif v_linha.tabela = 'contact_custom_values' and v_linha.acao = 'criou' then
      -- ⚠️ A identidade aqui é (contato, campo) — como em `contact_tags`.
      -- Apagando só por contato, sairiam os valores que o escritório
      -- preencheu à mão (e os do Calendly, que não são da Kommo).
      delete from contact_custom_values
       where contact_id = v_linha.registro_id
         and custom_field_id = (v_linha.detalhe->>'custom_field_id')::uuid;
      get diagnostics v_n = row_count; v_valores := v_valores + v_n;

    elsif v_linha.tabela = 'conversations' and v_linha.acao = 'criou' then
      -- ⚠️⚠️ Só sai a conversa que continua VAZIA. `conversations` cascateia
      -- para `messages`: se o cliente escreveu depois da carga, a conversa
      -- reabriu sozinha (é o desenho da seção 8 do de-para) e apagá-la levaria
      -- a conversa dele junto. Anotação que sobrou também segura — ela pode
      -- ter sido escrita por gente depois.
      delete from conversations c
       where c.id = v_linha.registro_id
         and c.account_id = p_account_id
         and not exists (select 1 from messages m where m.conversation_id = c.id)
         and not exists (select 1 from cb_conversation_notes n where n.conversation_id = c.id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        v_retidas := v_retidas || jsonb_build_object('conversation_id', v_linha.registro_id);
      else
        v_conversas := v_conversas + v_n;
      end if;

    elsif v_linha.tabela = 'tags' and v_linha.acao = 'criou' then
      -- Só sai a etiqueta que ninguém está usando. Se sobrou aplicação, ela
      -- foi feita por gente (ou o desfazer de `contact_tags` falhou) e apagar
      -- levaria a aplicação junto pela FK.
      delete from tags t
       where t.id = v_linha.registro_id
         and t.account_id = p_account_id
         and not exists (select 1 from contact_tags ct where ct.tag_id = t.id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        v_retidas := v_retidas || jsonb_build_object('tag_id', v_linha.registro_id);
      else
        v_tags := v_tags + v_n;
      end if;

    elsif v_linha.tabela = 'contacts' and v_linha.acao = 'alterou' then
      -- Devolve os três campos que a carga pode ter mexido. `email` volta ao
      -- valor anterior e o gatilho da 1000 reescreve (ou apaga) o espelho
      -- sozinho — por isso o valor do campo espelhado NÃO está no livro.
      update contacts c
         set name           = v_linha.antes->>'name',
             nome_fixado_em = nullif(v_linha.antes->>'nome_fixado_em', '')::timestamptz,
             email          = nullif(v_linha.antes->>'email', '')
       where c.id = v_linha.registro_id and c.account_id = p_account_id;
      get diagnostics v_n = row_count; v_fichas_up := v_fichas_up + v_n;

    elsif v_linha.tabela = 'contacts' and v_linha.acao = 'criou' then
      -- ⚠️⚠️ Só sai a ficha que continua SEM VÍNCULO NENHUM. `contacts`
      -- cascateia para `conversations` e daí para `messages`: se o cliente
      -- escreveu durante a carga, apagar a ficha apagaria a conversa dele.
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

  return jsonb_build_object(
    'linhas',     v_total,
    'cards',      v_cards,
    'alterados',  v_alterados,
    'etiquetas',  v_etiquetas,
    'eventos',    v_eventos,
    'fichas',     v_fichas,
    'fichas_revertidas', v_fichas_up,
    'valores',    v_valores,
    'conversas',  v_conversas,
    'notas',      v_notas,
    'tags',       v_tags,
    'retidas',    v_retidas);
end;
$desfazer$;

-- ------------------------------------------------------------
-- 4. Privilégios — as DUAS metades, sempre.
--
-- `REVOKE ... FROM PUBLIC` sozinho não tira nada quando a concessão é
-- explícita por papel, e `FROM anon, authenticated` sozinho não tira nada
-- quando ela veio de PUBLIC. Este erro já foi cometido três vezes neste banco
-- (903, 912, 914). O `GRANT` de volta para `service_role` é obrigatório: em
-- Postgres o EXECUTE de função nasce concedido a PUBLIC, e revogá-lo tira o
-- do service_role junto — invisível aqui, fatal num banco novo.
-- ------------------------------------------------------------
revoke execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  to service_role;

revoke execute on function public.cb_kommo_carregar_conversas(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_conversas(uuid, jsonb, boolean)
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
  v_lista text;
begin
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo like '%disable trigger%' then
    raise exception '1016: a função de pessoas desliga gatilho — o espelho de e-mail (1000) é gatilho e pararia de escrever';
  end if;
  if v_corpo not like '%^[0-9]{10,15}$%' then
    raise exception '1016: a função de pessoas não confere a regra 18 (telefone só dígitos)';
  end if;

  -- ⚠️ O teste é sobre a ALLOWLIST, não sobre o corpo inteiro: `'email'`
  -- aparece legitimamente no livro-razão (`jsonb_build_object('o_que',
  -- 'email')`), e procurá-lo solto reprova a migration correta. Já aconteceu,
  -- no primeiro ensaio desta 1016.
  v_lista := substring(v_corpo from 'c_permitidos constant text\[\] := array\[(.*?)\]');
  if v_lista is null then
    raise exception '1016: não achei a allowlist de campos na função de pessoas';
  end if;
  if v_lista like '%email%' then
    raise exception '1016: a allowlist aceita e-mail — ele entra por contacts.email, e gravar os dois lados dá 23505 (regra 24)';
  end if;
  if v_lista not like '%tamanho_da_divida%' or v_lista not like '%nome_da_campanha%'
     or v_lista not like '%nome_do_conjunto%' or v_lista not like '%nome_do_anuncio%'
     or v_lista not like '%kommo_contact_id%' then
    raise exception '1016: a allowlist perdeu uma das cinco chaves da carga (regra 23)';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_conversas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%''closed''%' then
    raise exception '1016: a conversa da carga não nasce encerrada';
  end if;
  if v_corpo not like '%n.texto = v_nota->>''texto''%' then
    raise exception '1016: a anotação não tem cerca de idempotência — reexecutar duplicaria';
  end if;

  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_desfazer(uuid, bigint, boolean)'::regprocedure;
  if v_corpo not like '%tabela = ''contacts'' and v_linha.acao = ''alterou''%'
     or v_corpo not like '%tabela = ''contact_custom_values''%'
     or v_corpo not like '%tabela = ''conversations''%'
     or v_corpo not like '%tabela = ''cb_conversation_notes''%'
     or v_corpo not like '%tabela = ''tags''%' then
    raise exception '1016: o desfazer não conhece as cinco tabelas novas';
  end if;
  if v_corpo not like '%from messages m where m.conversation_id = c.id%' then
    raise exception '1016: o desfazer apagaria conversa COM mensagem — levaria as mensagens junto';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_conversas(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1016: as funções ficaram executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_carregar_conversas(uuid, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1016: service_role perdeu o execute';
  end if;

  raise notice '1016: pessoa, conversa e anotação entraram no livro-razão.';
end
$conferir$;
