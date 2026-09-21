-- ============================================================
-- 1024 — A chave única do telefone passa a ser a grafia CANÔNICA do nono
-- dígito.
--
-- O índice da 0022 compara `phone_normalized` por igualdade EXATA, e o mesmo
-- celular brasileiro existe em duas grafias: "558388745316" (o JID que o
-- WhatsApp entrega para número antigo) e "5583988745316" (como gente digita).
-- Todo caminho "procura, depois insere" podia criar a segunda ficha — a
-- busca e o INSERT são duas instruções, e o índice não via as duas grafias
-- como a mesma pessoa. A ficha duplicada divide o histórico do cliente em
-- duas conversas.
--
-- `telefone_canonico` é só dígitos e, no celular brasileiro de 12 dígitos
-- (55 + DDD + 8, começando em 6–9), com o 9 depois do DDD — a MESMA régua de
-- `variantesDoNonoDigito` e de `telefoneCanonico`
-- (src/lib/contacts/telefone.ts), com teste lendo este arquivo. O índice
-- único parcial `(account_id, telefone_canonico)` faz a segunda grafia levar
-- 23505, e todo escritor de `contacts` relê a ficha que venceu.
--
-- ⚠️ A coluna sai de `phone`, repetindo o regexp_replace, e NÃO de
-- `phone_normalized`: o Postgres não deixa coluna gerada ler outra gerada.
--
-- ⚠️ O índice da 0022 FICA. É redundante (mesma grafia ⇒ mesma canônica),
-- mas é alvo nomeado de ON CONFLICT em migrations antigas e o dublê dos
-- testes o simula; apagá-lo custaria mexer em quem o nomeia, sem ganho.
--
-- ⚠️ Pré-voo: com um par de irmãs já gravado numa conta, o CREATE UNIQUE
-- INDEX falharia. A migration PARA com a contagem em vez de fundir: fundir
-- ficha é a receita do CLAUDE.md (reapontar as tabelas que apontam para
-- `contacts`), e `merge_duplicate_contacts` NÃO serve — agrupa por igualdade
-- exata e apaga as tarefas do perdedor por CASCADE. Medido em produção em
-- 21/09/2026, imediatamente antes: 5.106 fichas, ZERO pares; 2.839 fichas
-- gravadas sem o 9 ganham a chave com ele. Os pares ambíguos da seção 9 do
-- de-para da Kommo (mesmos 8 finais, DDDs diferentes — duas PESSOAS)
-- continuam distintos: a canônica não os junta.
--
-- ⚠️ A função de pessoas da carga da Kommo é redefinida (corpo da 1023) só
-- para o ON CONFLICT perder o alvo: com alvo, o índice novo não seria
-- absorvido e o 23505 da corrida abortaria o lote inteiro.
--
-- Custo: ADD COLUMN ... STORED reescreve a tabela (ACCESS EXCLUSIVE durante
-- a reescrita — 5.106 linhas, fração de segundo) e o CREATE UNIQUE INDEX
-- segura as escritas enquanto constrói.
-- ============================================================

alter table public.contacts
  add column if not exists telefone_canonico text
  generated always as (
    regexp_replace(regexp_replace(phone, '\D', '', 'g'),
                   '^(55[0-9]{2})([6-9][0-9]{7})$', '\19\2')
  ) stored;

comment on column public.contacts.telefone_canonico is
  'Só dígitos; no celular brasileiro de 12 dígitos, com o nono dígito. '
  'Chave única por conta (1024). Espelho: telefoneCanonico() em src/lib/contacts/telefone.ts.';

do $prevoo$
declare
  v_pares   int;
  v_exemplo text;
begin
  select count(*), min(t.account_id::text || ' / ' || t.telefone_canonico)
    into v_pares, v_exemplo
    from (select account_id, telefone_canonico
            from public.contacts
           where telefone_canonico <> ''
           group by account_id, telefone_canonico
          having count(*) > 1) t;
  if v_pares > 0 then
    raise exception '1024: % par(es) de fichas com a mesma grafia canônica (ex.: %). '
                    'Funda pela receita do CLAUDE.md antes de aplicar — '
                    'merge_duplicate_contacts NÃO serve.', v_pares, v_exemplo;
  end if;
end
$prevoo$;

create unique index if not exists idx_contacts_account_telefone_canonico
  on public.contacts (account_id, telefone_canonico)
  where telefone_canonico <> '';

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
    -- a janela para o delta do dia do corte.) Desde a 1024 o banco também
    -- barra a irmã (índice canônico); esta busca é o que evita o conflito.
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
      -- ⚠️ SEM alvo (1024). Com alvo, o ON CONFLICT só absorvia o índice
      -- EXATO da 0022; a irmã do nono dígito criada por outro caminho entre
      -- a busca acima e este INSERT bate no índice CANÔNICO, e o 23505
      -- abortava a chamada inteira (e desligava junto o que ela fez). Sem
      -- alvo, qualquer único absorve, e a releitura abaixo — pelas duas
      -- grafias — acha a ficha que venceu.
      on conflict do nothing
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
        -- ⚠️ TRAVADO (Codex, PR #232): a decisão "o nome é vazio ou
        -- telefone, e ninguém o fixou" tem de valer no instante da escrita.
        -- Sem o FOR UPDATE, a ingestão ou a equipe podiam trocar o nome entre
        -- esta leitura e o UPDATE, e a carga gravaria o nome da Kommo por
        -- cima. Sob trava o Postgres RELÊ a linha depois da escrita
        -- concorrente e reavalia o filtro: o nome novo não é mais telefone,
        -- a linha sai, e nada é escrito.
        select to_jsonb(c) - 'phone_normalized' into v_antes
          from contacts c
         where c.id = v_contato and c.account_id = p_account_id
           and c.nome_fixado_em is null
           and (c.name is null or btrim(c.name) = '' or btrim(c.name) ~ '^[0-9 ()+-]+$')
           and btrim(c.name) is distinct from v_nome
           for update of c;
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

          -- A regra repetida no UPDATE é a segunda defesa: sob a trava acima
          -- ela é sempre verdadeira, e é por isso que o livro só ganha a
          -- linha quando a escrita de fato aconteceu.
          update contacts
             set name = v_nome, nome_fixado_em = now()
           where id = v_contato and account_id = p_account_id
             and nome_fixado_em is null
             and (name is null or btrim(name) = '' or btrim(name) ~ '^[0-9 ()+-]+$');
          get diagnostics v_n = row_count;
          if v_n > 0 then
            insert into migracao_kommo.livro_razao
                   (account_id, acao, tabela, registro_id, antes, detalhe)
            values (p_account_id, 'alterou', 'contacts', v_contato, v_antes,
                    jsonb_build_object('o_que', 'nome'));
            v_nomes := v_nomes + 1;
          end if;
        end if;
      end if;
    end if;

    if v_email is not null then
      -- ⚠️ TRAVADO e repetido no UPDATE (Codex, PR #232, P1): outro
      -- escritor que preenchesse o e-mail entre a leitura e a escrita — a
      -- ficha, o Calendly, a API — era sobrescrito pelo e-mail da Kommo,
      -- contra a regra "só preenche e-mail VAZIO". Sob o FOR UPDATE o
      -- Postgres reavalia o filtro sobre a versão nova da linha, e a regra
      -- repetida no UPDATE garante que o livro só registra escrita real.
      select to_jsonb(c) - 'phone_normalized' into v_antes
        from contacts c
       where c.id = v_contato and c.account_id = p_account_id
         and (c.email is null or btrim(c.email) = '')
         for update of c;
      if v_antes is not null then
        update contacts set email = v_email
         where id = v_contato and account_id = p_account_id
           and (email is null or btrim(email) = '');
        get diagnostics v_n = row_count;
        if v_n > 0 then
          insert into migracao_kommo.livro_razao
                 (account_id, acao, tabela, registro_id, antes, detalhe)
          values (p_account_id, 'alterou', 'contacts', v_contato, v_antes,
                  jsonb_build_object('o_que', 'email'));
          v_emails := v_emails + 1;
        end if;
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

revoke execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)
  to service_role;

do $conferir$
declare
  v_expr   text;
  v_def    text;
  v_corpo  text;
  v_conta  uuid;
  v_dono   uuid;
  v_colidiu boolean := false;
begin
  -- a coluna é GERADA e sai de `phone` com a régua do nono dígito
  select pg_get_expr(d.adbin, d.adrelid) into v_expr
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.contacts'::regclass
     and a.attname = 'telefone_canonico' and a.attgenerated = 's';
  if v_expr is null then
    raise exception '1024: contacts.telefone_canonico não existe ou não é coluna gerada';
  end if;
  -- strpos, e não LIKE: em LIKE a barra invertida é escape, e '\19\2' viraria "192".
  if strpos(v_expr, '(55[0-9]{2})([6-9][0-9]{7})') = 0 or strpos(v_expr, '\19\2') = 0
     or strpos(v_expr, 'phone') = 0 or strpos(v_expr, 'phone_normalized') > 0 then
    raise exception '1024: a expressão da coluna canônica mudou: %', v_expr;
  end if;

  -- o índice é ÚNICO, parcial e sobre (account_id, telefone_canonico)
  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'idx_contacts_account_telefone_canonico' and i.indisunique;
  if v_def is null or v_def not like '%(account_id, telefone_canonico)%'
     or v_def not like '%WHERE%telefone_canonico%' then
    raise exception '1024: o índice canônico não está como deveria: %', v_def;
  end if;

  -- o índice da 0022 continua (alvo nomeado em migrations antigas)
  if not exists (select 1 from pg_class where relname = 'idx_contacts_account_phone_normalized') then
    raise exception '1024: o índice da 0022 sumiu';
  end if;

  -- COMPORTAMENTO: as duas grafias do mesmo celular colidem — 550087654321
  -- (sem o 9) e "+55 (00) 98765-4321" (com o 9 e separadores). DDD 00 não
  -- existe, então nenhuma ficha real está no caminho. Só onde existe conta
  -- (em banco vazio não há dono para a ficha); tudo desfeito pelo bloco com
  -- EXCEPTION, que é um savepoint.
  select id, owner_user_id into v_conta, v_dono from public.accounts
   where owner_user_id is not null limit 1;
  if v_conta is null then
    raise notice '1024: banco sem conta — a colisão das grafias fica para o ensaio.';
  else
    begin
      insert into public.contacts (account_id, user_id, name, phone)
      values (v_conta, v_dono, 'conferencia 1024', '5500' || '87654321');
      begin
        insert into public.contacts (account_id, user_id, name, phone)
        values (v_conta, v_dono, 'conferencia 1024', '+55 (00) 9' || '8765-4321');
      exception when unique_violation then
        v_colidiu := true;
      end;
      raise exception using errcode = 'P0001', message = 'desfazer-conferencia-1024';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'desfazer-conferencia-1024' then raise; end if;
    end;
    if not v_colidiu then
      raise exception '1024: as duas grafias do mesmo celular NÃO colidiram';
    end if;
  end if;

  -- a função de pessoas perdeu o ALVO do ON CONFLICT e manteve o resto
  select prosrc into v_corpo from pg_proc
   where oid = 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)'::regprocedure;
  if v_corpo not like '%on conflict do nothing%'
     or v_corpo like '%on conflict (account_id, phone_normalized)%' then
    raise exception '1024: o INSERT de pessoas voltou a ter ON CONFLICT com alvo';
  end if;
  if (length(v_corpo) - length(replace(v_corpo, 'for update of c', ''))) / length('for update of c') < 2
     or v_corpo not like '%and (email is null or btrim(email) = '''')%'
     or v_corpo not like '%''valor'', btrim(v_par.valor)%'
     or v_corpo not like '%phone_normalized in (v_telefone, coalesce(v_irma, v_telefone))%'
     or v_corpo not like '%alter table public.deals disable trigger user%' then
    raise exception '1024: a função de pessoas perdeu uma guarda da 1017/1020/1022/1023';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1024: cb_kommo_carregar_pessoas ficou executável pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_pessoas(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1024: service_role perdeu o execute de cb_kommo_carregar_pessoas';
  end if;

  raise notice '1024: a chave do telefone é a grafia canônica do nono dígito.';
end
$conferir$;
