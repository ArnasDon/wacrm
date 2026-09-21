-- ============================================================
-- 1013 — A carga da Kommo: o LIVRO-RAZÃO e a FUNÇÃO DE LOTE.
--
-- O contrato A.1 do `docs/PLANO-migracao-kommo.md` fecha a mecânica: a carga
-- escreve por LOTE, por uma função no banco, porque as duas formas óbvias
-- estão erradas em direções opostas (o PostgREST não tem transação de várias
-- instruções; uma transação única estoura o cache de subtransações e degrada
-- o CRM inteiro). Esta migration entrega essa função e o livro que torna a
-- carga DESFAZÍVEL.
--
-- ⚠️⚠️ A DECISÃO QUE O PLANO DEIXOU ABERTA: entre REPARAR a trilha dos
-- gatilhos e DESLIGAR os gatilhos, esta migration escolhe **reparar**. Os três
-- motivos, todos medidos:
--
--   1. `DISABLE TRIGGER USER` pega ACCESS EXCLUSIVE em `deals` pela transação
--      inteira e vale para TODAS as sessões. A decisão 23 do operador é que a
--      carga tem de nascer tolerante a um CRM em uso — e travar o Kanban, a
--      Lista, o Meu dia e o roteador de ingestão a cada lote é o contrário
--      disso.
--   2. Desligar os gatilhos desliga junto o carimbo da 950, e aí a carga
--      precisa CALCULAR ganho/perdido por conta própria — uma segunda cópia
--      de uma regra que mora no banco, do tipo que este repositório já pagou
--      caro para aprender (`resultado.ts` é espelho do gatilho, e o CLAUDE.md
--      manda mudar os dois juntos). Com os gatilhos de pé, quem decide o
--      status é a 950, e a função só CONFERE.
--   3. `session_replication_role = 'replica'` desliga as FKs junto. Numa carga
--      de 12.611 linhas isso troca uma violação que o banco pegaria na hora
--      por cards apontando para nada.
--
-- ⚠️⚠️ TRÊS INVARIANTES, e cada uma falha em SILÊNCIO se for ignorada:
--
-- 1. RODAR DUAS VEZES = RODAR UMA, e "uma vez" quer dizer ZERO ESCRITA na
--    segunda passada — não escrita com o mesmo valor. Escrever o mesmo valor
--    ainda dispara `set_updated_at`, ainda move a tupla no heap (é o que torna
--    `findExistingContact` não-determinístico nos 4 telefones ambíguos) e
--    ainda enche o livro-razão de linhas que o desfazer vai ler. Por isso todo
--    UPDATE aqui é condicionado a `IS DISTINCT FROM`, e o retorno traz
--    `escritas`, que a segunda passada do piloto exige ser 0.
--
-- 2. O REPARO ALCANÇA SÓ O QUE ESTA TRANSAÇÃO ESCREVEU. São TRÊS cercas e
--    DUAS afirmações — ver as seções 3 e 5. Nenhuma delas é `xmin`: medido em
--    21/09, os gatilhos escrevem em SUBTRANSAÇÃO, a linha leva o subxid e
--    `pg_current_xact_id()` devolve o id do TOPO; o recorte casa ZERO.
--
-- 3. DESFAZER PRECISA SABER O QUE JÁ EXISTIA. Dos 12.611 cards, ~1.150 não
--    nascem na carga: eles são MOVIDOS (decisão 11), e os contatos deles são
--    do escritório, com conversa e mensagens. Apagar por etiqueta levaria tudo
--    junto. O livro-razão guarda, linha a linha, se a carga CRIOU ou ALTEROU,
--    e no segundo caso o valor ANTERIOR.
-- ============================================================

-- ------------------------------------------------------------
-- 1) O instante da foto da Kommo, no card
-- ------------------------------------------------------------
-- ⚠️ A função PULA o grupo cujo card já existe (é o que torna `cb_lead_events`
-- idempotente sem restrição única). O preço seria um lead que MUDOU na Kommo
-- depois de migrado ser pulado em silêncio. Com esta coluna o pulo deixa de
-- ser silencioso: a função compara o carimbo da foto e RECUSA o grupo com
-- motivo escrito, que sai no retorno e vira lista para o operador.
-- Re-sincronizar lead já migrado é decisão do corte (decisão 14), não desta
-- função.
alter table public.deals
  add column if not exists kommo_atualizado_em timestamptz;

comment on column public.deals.kommo_atualizado_em is
  'Instante do `updated_at` do lead na Kommo quando a carga tirou a foto. '
  'Nulo em todo negócio nascido aqui.';

-- ------------------------------------------------------------
-- 2) O livro-razão — em schema PRÓPRIO, fora do alcance do PostgREST
-- ------------------------------------------------------------
-- ⚠️⚠️ NÃO em `public`, e a razão é do PR #232 (3ª rodada do Codex): tabela de
-- apoio criada em `public` herda a concessão padrão do Supabase para
-- `anon`/`authenticated` e, se vier de `CREATE TABLE ... AS`, nasce sem RLS —
-- foi o buraco que a 901, a 906 e a 912 abriram e que a 931 fechou. O livro
-- guarda nome e e-mail de cliente em `antes`. Schema próprio é uma barreira
-- que não depende de a RLS e os GRANTs estarem certos: o PostgREST expõe
-- `public`, e o que não está lá não tem URL.
create schema if not exists migracao_kommo;
revoke all on schema migracao_kommo from public, anon, authenticated;
grant usage on schema migracao_kommo to service_role;

create table if not exists migracao_kommo.cargas (
  id                uuid primary key,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  rotulo            text not null,
  iniciada_em       timestamptz not null default now(),
  ultimo_lote_em    timestamptz,
  lotes             integer not null default 0,
  grupos_recebidos  integer not null default 0,
  cards_criados     integer not null default 0,
  cards_movidos     integer not null default 0,
  grupos_pulados    integer not null default 0,
  grupos_recusados  integer not null default 0,
  desfeita_em       timestamptz
);

comment on table migracao_kommo.cargas is
  'Uma linha por EXECUÇÃO da carga da Kommo (piloto, carga final, delta do corte).';

create table if not exists migracao_kommo.linhas (
  id            bigint generated always as identity primary key,
  carga_id      uuid not null references migracao_kommo.cargas(id) on delete cascade,
  lote          integer not null,
  kommo_lead_id bigint,
  tabela        text not null,
  -- ⚠️ SEM chave estrangeira, e de propósito — o mesmo motivo de
  -- `cb_lead_events.deal_id`: o livro tem de sobreviver ao desfazer, que apaga
  -- justamente a linha apontada. Com FK, a linha `criou` seria impossível de
  -- manter depois de desfeita, e o livro deixaria de provar o que foi desfeito.
  registro_id   uuid,
  acao          text not null check (acao in ('criou', 'alterou', 'recusou')),
  -- Só em `alterou`: as colunas que a carga mudou, com o valor ANTERIOR. É a
  -- única cópia — `contacts.name`, `nome_fixado_em`, `deals.stage_id` e o
  -- valor do campo personalizado são sobrescritos sem rastro nenhum.
  antes         jsonb,
  detalhe       text,
  criado_em     timestamptz not null default clock_timestamp()
);

create index if not exists linhas_carga_idx on migracao_kommo.linhas (carga_id, lote, id);
create index if not exists linhas_registro_idx on migracao_kommo.linhas (tabela, registro_id);

comment on table migracao_kommo.linhas is
  'Uma linha por REGISTRO que a carga escreveu. Desfazer é ler de trás para frente.';

-- Cinto e suspensório: mesmo fora de `public`, RLS ligada e os papéis do
-- navegador sem nada. As duas metades, como manda o CLAUDE.md.
alter table migracao_kommo.cargas enable row level security;
alter table migracao_kommo.linhas enable row level security;
revoke all on table migracao_kommo.cargas from public, anon, authenticated;
revoke all on table migracao_kommo.linhas from public, anon, authenticated;
grant all on table migracao_kommo.cargas to service_role;
grant all on table migracao_kommo.linhas to service_role;

-- ------------------------------------------------------------
-- 3) A função de lote
-- ------------------------------------------------------------
-- Fica em `public` porque é chamada por RPC do PostgREST — é o único objeto da
-- carga que precisa de URL.
create or replace function public.cb_kommo_carregar_lote(
  p_conta  uuid,
  p_carga  uuid,
  p_rotulo text,
  p_lote   integer,
  p_grupos jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $funcao$
declare
  -- ⚠️⚠️ A TERCEIRA CERCA, e a que fecha o buraco que o plano deixou aberto.
  -- `now()` é o `transaction_timestamp()`: constante na transação INTEIRA,
  -- subtransações inclusive. Os gatilhos da 912/933 gravam `created_at`/
  -- `criado_em` pelo DEFAULT `now()` e `occurred_at` pelo DEFAULT
  -- `clock_timestamp()` — MEDIDO em produção: o par stage_changed +
  -- status_changed de um mesmo save DIVIDE `created_at` e DIFERE em
  -- `occurred_at` (1.326 linhas em 1.310 instantes distintos).
  -- Nem o anti-join nem o piso de tempo identificam a transação que escreveu
  -- (achado do Codex, 3ª rodada do #232): uma etiqueta aplicada por gente
  -- DEPOIS da foto entra nos dois recortes. Esta cerca a exclui, e as
  -- afirmações da seção 5 pegam o resto.
  v_transacao      timestamptz := now();

  v_dono           uuid;
  v_grupo          jsonb;
  v_pessoa         jsonb;
  v_card           jsonb;
  v_nota           jsonb;
  v_item           jsonb;

  v_tel            text;
  v_nome           text;
  v_email          text;
  v_contato        uuid;
  v_conversa       uuid;
  v_deal           uuid;
  v_alvo           uuid;
  v_chave          bigint;
  v_campo          uuid;
  v_valor_antes    text;
  v_nome_antes     text;
  v_fixado_antes   timestamptz;
  v_email_antes    text;
  v_status_antes   text;
  v_status_final   text;
  v_linha_antes    jsonb;
  v_nota_id        uuid;
  v_ct             uuid;
  v_n              integer;
  v_ordem          integer;
  v_anterior       timestamptz;

  -- Pré-existentes: é sobre eles que a foto do anti-join é tirada. Card e
  -- contato NOVOS não têm histórico anterior, por definição.
  v_contatos_ja    uuid[] := '{}';
  v_cards_ja       uuid[] := '{}';
  -- Tudo o que o lote tocou, para o recorte do reparo e das afirmações.
  v_contatos       uuid[] := '{}';
  v_cards          uuid[] := '{}';
  v_trilha_foto    uuid[] := '{}';
  v_fila_foto      uuid[] := '{}';

  v_eventos        jsonb := '[]'::jsonb;
  v_esperados      integer := 0;
  -- Quantas linhas os gatilhos de CARD devem ter escrito neste lote. É o que
  -- torna a afirmação da seção 5 EXATA em vez de probabilística.
  v_gatilho_card   integer := 0;

  -- ⚠️ A recusa é decidida na passada de LEITURA e o grupo é abandonado ANTES
  -- de qualquer escrita. Decidida no meio da passada de escrita — que foi a
  -- primeira forma, e o teste no bench pegou — ela deixava para trás o
  -- CONTATO, as etiquetas e os campos de um grupo cujo card foi recusado: um
  -- cliente sem card, que ninguém pediu e que só o livro-razão saberia
  -- explicar.
  v_recusar        bigint[] := '{}';
  v_recusados      jsonb := '[]'::jsonb;

  v_criados        integer := 0;
  v_movidos        integer := 0;
  v_pulados        integer := 0;
  v_cont_criados   integer := 0;
  v_cont_alterados integer := 0;
  v_etiquetas      integer := 0;
  v_campos         integer := 0;
  v_conversas      integer := 0;
  v_notas          integer := 0;
  v_ev_inseridos   integer := 0;
  v_trilha_apagada integer := 0;
  v_trilha_marcada integer := 0;
  v_fila_apagada   integer := 0;
  v_escritas       integer := 0;

  -- ⚠️⚠️ ALLOWLIST FECHADA, no código e não em parâmetro (contrato D.22/D.23).
  -- Criar campo "pelo nome da Kommo" gera chave NOVA sem colidir: os 3.672
  -- valores de anúncio pousariam onde ninguém lê e `{{contact.origem}}`
  -- continuaria vazio no aviso que o advogado recebe a cada agendamento. E
  -- `Data e Hora Reunião` e `Link Reunião` são do Calendly — 106 valores vivos
  -- — e não são território da Kommo. Um parâmetro deixaria o chamador alargar
  -- isto, que é exatamente o que a regra existe para impedir.
  c_campos constant text[] := array[
    'tamanho_da_divida', 'nome_da_campanha', 'nome_do_conjunto',
    'nome_do_anuncio', 'kommo_contact_id'
  ];
  c_tipos_de_card constant text[] := array[
    'deal_created', 'stage_changed', 'pipeline_changed', 'status_changed', 'deal_deleted'
  ];
begin
  -- ==========================================================
  -- 0. Cercas de entrada
  -- ==========================================================
  if p_conta is null or p_carga is null or p_lote is null or p_rotulo is null then
    raise exception 'carga kommo: conta, carga, rótulo e lote são obrigatórios';
  end if;
  if jsonb_typeof(p_grupos) is distinct from 'array' then
    raise exception 'carga kommo: p_grupos precisa ser um array jsonb, veio %',
      coalesce(jsonb_typeof(p_grupos), 'null');
  end if;

  -- ⚠️ O dono DURÁVEL da conta, sem queda para quem roda a carga.
  -- `contacts.user_id`, `conversations.user_id` e `custom_fields.user_id`
  -- cascateiam de `auth.users`: apagar o login de quem rodou a carga — o passo
  -- normal de offboarding, FORA do app — levaria os 12.980 contatos, as
  -- conversas e todas as mensagens junto.
  select owner_user_id into v_dono from accounts where id = p_conta;
  if v_dono is null then
    raise exception 'carga kommo: conta % não existe ou não tem dono', p_conta;
  end if;

  insert into migracao_kommo.cargas (id, account_id, rotulo)
  values (p_carga, p_conta, p_rotulo)
  on conflict (id) do nothing;

  -- Reusar o id de uma carga de outra conta ou com outro rótulo embaralharia o
  -- desfazer de duas execuções.
  if not exists (
    select 1 from migracao_kommo.cargas
     where id = p_carga and account_id = p_conta and rotulo = p_rotulo
  ) then
    raise exception 'carga kommo: a carga % já existe com outra conta ou outro rótulo', p_carga;
  end if;
  if exists (select 1 from migracao_kommo.cargas where id = p_carga and desfeita_em is not null) then
    raise exception 'carga kommo: a carga % foi desfeita; use um id novo', p_carga;
  end if;

  -- ==========================================================
  -- 1. Passada de LEITURA — quem já existe aqui, e o que é recusado
  -- ==========================================================
  for v_grupo in select value from jsonb_array_elements(p_grupos) loop
    v_pessoa := v_grupo -> 'pessoa';
    v_card   := v_grupo -> 'card';
    v_chave  := (v_grupo ->> 'kommo_lead_id')::bigint;

    if v_chave is null then
      raise exception 'carga kommo: grupo sem kommo_lead_id';
    end if;

    v_tel := v_pessoa ->> 'telefone';
    -- ⚠️ SÓ DÍGITOS COM DDI, exatamente o que `digitosDoTelefone` produz.
    -- Gravado com separadores a ficha entra normalmente e a PRIMEIRA mensagem
    -- daquele cliente é descartada em silêncio — e todas as seguintes, para
    -- sempre: a busca não acha a ficha, o INSERT leva 23505, a recuperação
    -- falha igual, e a ingestão desiste. O WhatsApp já respondeu 200.
    if v_tel is null or v_tel !~ '^[0-9]{10,15}$' then
      raise exception 'carga kommo: lead % tem telefone inválido (%) — só dígitos com DDI, 10 a 15',
        v_chave, coalesce(v_tel, '(nulo)');
    end if;

    select id into v_contato
      from contacts
     where account_id = p_conta and phone_normalized = v_tel;
    if v_contato is not null and not (v_contato = any(v_contatos_ja)) then
      v_contatos_ja := v_contatos_ja || v_contato;
    end if;

    v_alvo := nullif(v_card ->> 'alvo_id', '')::uuid;
    if v_alvo is not null then
      v_cards_ja := v_cards_ja || v_alvo;
    end if;

    -- Grupo já migrado não é recusa — é pulo, e é decidido na passada de
    -- escrita (lá está a comparação com a foto da Kommo).
    if exists (select 1 from deals where account_id = p_conta and kommo_lead_id = v_chave) then
      continue;
    end if;

    if v_alvo is not null then
      -- ⚠️ `alvo_id` é INTENÇÃO do script (a regra "um card por pessoa e área"
      -- mora no de-para, não aqui) e é VALIDADO: conta, contato e
      -- `kommo_lead_id` ainda nulo. Sem conferir, a carga moveria o card de
      -- OUTRA pessoa — e um card movido é justamente o que não tem como ser
      -- notado no meio de 12.611.
      if not exists (
        select 1 from deals
         where id = v_alvo and account_id = p_conta
           and contact_id is not distinct from v_contato
           and kommo_lead_id is null
      ) then
        v_recusar := v_recusar || v_chave;
        v_recusados := v_recusados || jsonb_build_object(
          'kommo_lead_id', v_chave, 'motivo', 'alvo_id_nao_confere', 'alvo_id', v_alvo);
      end if;
    elsif v_contato is not null and exists (
      select 1 from deals
       where account_id = p_conta and contact_id = v_contato
         and pipeline_id = (v_card ->> 'pipeline_id')::uuid
         and kommo_lead_id is null
    ) then
      -- "Um card por pessoa e por ÁREA" mora no CÓDIGO, não no banco (o índice
      -- da 911 só cobre `source = 'channel'`). Criar aqui faria exatamente o
      -- segundo card que a regra existe para impedir.
      v_recusar := v_recusar || v_chave;
      v_recusados := v_recusados || jsonb_build_object(
        'kommo_lead_id', v_chave, 'motivo', 'ja_ha_card_neste_funil_sem_alvo_id');
    end if;
  end loop;

  if jsonb_array_length(v_recusados) > 0 then
    insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao, detalhe)
    select p_carga, p_lote, (r ->> 'kommo_lead_id')::bigint, 'deals',
           nullif(r ->> 'alvo_id', '')::uuid, 'recusou', r ->> 'motivo'
      from jsonb_array_elements(v_recusados) r;
  end if;

  -- ⚠️ A FOTO. Guarda os ids de trilha e de fila que JÁ EXISTIAM para os
  -- contatos e os cards que este lote toca. É a cerca que o Codex pediu no
  -- PR #232 (P1): sem ela o reparo alcança o histórico inteiro do card — 9
  -- eventos antigos e 311 etiquetas reais, medidos em produção.
  select coalesce(array_agg(id), '{}') into v_trilha_foto
    from cb_lead_events
   where account_id = p_conta
     and (deal_id = any(v_cards_ja) or contact_id = any(v_contatos_ja));

  select coalesce(array_agg(id), '{}') into v_fila_foto
    from cb_automation_events
   where account_id = p_conta and deal_id = any(v_cards_ja);

  -- ==========================================================
  -- 2. Passada de ESCRITA
  -- ==========================================================
  for v_grupo in select value from jsonb_array_elements(p_grupos) loop
    v_pessoa := v_grupo -> 'pessoa';
    v_card   := v_grupo -> 'card';
    v_chave  := (v_grupo ->> 'kommo_lead_id')::bigint;
    v_tel    := v_pessoa ->> 'telefone';

    -- ---- 2.0 recusado na leitura: NADA é escrito para este grupo -----
    if v_chave = any(v_recusar) then
      continue;
    end if;

    -- ---- 2.1 o grupo já foi migrado? --------------------------------
    select id, kommo_atualizado_em into v_deal, v_anterior
      from deals
     where account_id = p_conta and kommo_lead_id = v_chave;

    if v_deal is not null then
      v_pulados := v_pulados + 1;
      -- Pulo SILENCIOSO só quando a foto da Kommo não andou. Andou, e o
      -- operador precisa saber: esta função migra um grupo UMA vez.
      if (v_card ->> 'kommo_atualizado_em') is not null
         and (v_anterior is null
              or (v_card ->> 'kommo_atualizado_em')::timestamptz > v_anterior) then
        v_recusados := v_recusados || jsonb_build_object(
          'kommo_lead_id', v_chave,
          'motivo', 'ja_migrado_e_mudou_na_kommo',
          'deal_id', v_deal);
        insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao, detalhe)
        values (p_carga, p_lote, v_chave, 'deals', v_deal, 'recusou', 'ja_migrado_e_mudou_na_kommo');
      end if;
      continue;
    end if;

    -- ---- 2.2 o contato ----------------------------------------------
    v_nome  := nullif(btrim(coalesce(v_pessoa ->> 'nome', '')), '');
    v_email := nullif(btrim(lower(coalesce(v_pessoa ->> 'email', ''))), '');

    select id, name, nome_fixado_em, email
      into v_contato, v_nome_antes, v_fixado_antes, v_email_antes
      from contacts
     where account_id = p_conta and phone_normalized = v_tel;

    if v_contato is null then
      insert into contacts (account_id, user_id, phone, name, email, nome_fixado_em)
      values (p_conta, v_dono, v_tel, v_nome, v_email,
              case when (v_pessoa ->> 'fixar_nome')::boolean is true and v_nome is not null
                   then v_transacao end)
      -- Sem alvo de conflito: a corrida real aqui é a ingestão criando a mesma
      -- ficha entre a leitura e a escrita, e ela bate no índice parcial de
      -- `phone_normalized`, que é coluna GERADA — inferência de índice sobre
      -- coluna gerada é o tipo de detalhe que se descobre em produção.
      -- `DO NOTHING` cru não depende de inferência nenhuma.
      on conflict do nothing
      returning id into v_contato;

      if v_contato is null then
        select id, name, nome_fixado_em, email
          into v_contato, v_nome_antes, v_fixado_antes, v_email_antes
          from contacts
         where account_id = p_conta and phone_normalized = v_tel;
        if v_contato is null then
          raise exception 'carga kommo: não consegui criar nem reencontrar o contato do telefone % (lead %)',
            v_tel, v_chave;
        end if;
      else
        v_cont_criados := v_cont_criados + 1;
        v_escritas := v_escritas + 1;
        insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao)
        values (p_carga, p_lote, v_chave, 'contacts', v_contato, 'criou');
        v_nome_antes := v_nome; v_fixado_antes := null; v_email_antes := v_email;
      end if;
    end if;

    if not (v_contato = any(v_contatos)) then
      v_contatos := v_contatos || v_contato;
    end if;

    -- Nome e e-mail, cada um com a sua cerca, e SÓ quando muda de verdade.
    -- ⚠️ `nome_fixado_em IS NULL` protege os 297 nomes fixados à mão mesmo se
    -- a foto que o script usou estiver velha. ⚠️ E o e-mail entra só onde está
    -- VAZIO: são 54 e-mails aqui, do Calendly e do Asaas, os mais recentes da
    -- base, contra um da Kommo de até 15 meses — sobrescrevê-los faria o
    -- vínculo automático do tl;dv casar pelo e-mail errado.
    v_linha_antes := '{}'::jsonb;

    if v_nome is not null and (v_pessoa ->> 'fixar_nome')::boolean is true then
      update contacts
         set name = v_nome, nome_fixado_em = coalesce(nome_fixado_em, v_transacao)
       where id = v_contato
         and nome_fixado_em is null
         and name is distinct from v_nome;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_linha_antes := v_linha_antes
          || jsonb_build_object('name', v_nome_antes, 'nome_fixado_em', v_fixado_antes);
      end if;
    end if;

    if v_email is not null then
      -- ⚠️ UM LADO SÓ. `contacts.email` tem espelho no banco (1000/1001):
      -- gravar também a linha do campo personalizado dá 23505 e derruba o
      -- lote. Quem escreve o campo é o gatilho.
      update contacts set email = v_email
       where id = v_contato
         and (email is null or btrim(email) = '')
         and email is distinct from v_email;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_linha_antes := v_linha_antes || jsonb_build_object('email', v_email_antes);
      end if;
    end if;

    if v_linha_antes <> '{}'::jsonb then
      v_cont_alterados := v_cont_alterados + 1;
      v_escritas := v_escritas + 1;
      insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao, antes)
      values (p_carga, p_lote, v_chave, 'contacts', v_contato, 'alterou', v_linha_antes);
    end if;

    -- ---- 2.3 etiquetas ----------------------------------------------
    -- ⚠️ INSERT DIRETO, nunca `tag-events.ts`: por ali o gatilho `tag_added`
    -- das AUTOMAÇÕES dispararia dezenas de milhares de vezes. Do gatilho de
    -- AUDITORIA (912) não há como fugir — é ele que a seção 3 remarca.
    for v_item in select value from jsonb_array_elements(coalesce(v_pessoa -> 'etiquetas', '[]'::jsonb)) loop
      if not exists (select 1 from tags where id = (v_item #>> '{}')::uuid and account_id = p_conta) then
        raise exception 'carga kommo: etiqueta % não é desta conta (lead %)', v_item #>> '{}', v_chave;
      end if;
      insert into contact_tags (contact_id, tag_id)
      values (v_contato, (v_item #>> '{}')::uuid)
      on conflict (contact_id, tag_id) do nothing
      returning id into v_ct;
      if v_ct is not null then
        v_etiquetas := v_etiquetas + 1;
        v_escritas := v_escritas + 1;
        insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao)
        values (p_carga, p_lote, v_chave, 'contact_tags', v_ct, 'criou');
      end if;
    end loop;

    -- ---- 2.4 campos personalizados ----------------------------------
    for v_item in select value from jsonb_array_elements(coalesce(v_pessoa -> 'campos', '[]'::jsonb)) loop
      if not ((v_item ->> 'field_key') = any(c_campos)) then
        raise exception 'carga kommo: a carga não escreve no campo "%" (lead %) — allowlist: %',
          v_item ->> 'field_key', v_chave, array_to_string(c_campos, ', ');
      end if;
      select id into v_campo
        from custom_fields
       where account_id = p_conta and field_key = (v_item ->> 'field_key');
      if v_campo is null then
        raise exception 'carga kommo: o campo "%" não existe nesta conta — crie antes da carga (contrato D.22)',
          v_item ->> 'field_key';
      end if;
      -- Cerca estrutural, além da allowlist: campo ESPELHADO é escrito pelo
      -- gatilho a partir da ficha, e gravar os dois lados dá 23505.
      if exists (select 1 from custom_fields where id = v_campo and espelho is not null) then
        raise exception 'carga kommo: "%" é campo espelhado (1000/1001) — quem escreve é o gatilho, pela ficha',
          v_item ->> 'field_key';
      end if;
      if nullif(btrim(coalesce(v_item ->> 'valor', '')), '') is null then
        continue;  -- linha vazia nunca é gravada (de-para §11)
      end if;

      select value into v_valor_antes
        from contact_custom_values
       where contact_id = v_contato and custom_field_id = v_campo;

      insert into contact_custom_values (contact_id, custom_field_id, value)
      values (v_contato, v_campo, btrim(v_item ->> 'valor'))
      on conflict (contact_id, custom_field_id) do update
         set value = excluded.value
       where contact_custom_values.value is distinct from excluded.value
      returning id into v_campo;

      if v_campo is not null then
        v_campos := v_campos + 1;
        v_escritas := v_escritas + 1;
        insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao, antes)
        values (p_carga, p_lote, v_chave, 'contact_custom_values', v_campo,
                case when v_valor_antes is null then 'criou' else 'alterou' end,
                case when v_valor_antes is null then null
                     else jsonb_build_object('value', v_valor_antes) end);
      end if;
    end loop;

    -- ---- 2.5 conversa e anotações -----------------------------------
    -- A conversa é resolvida SEMPRE (uma por contato, índice único da 036) —
    -- é ela que o card criado guarda em `conversation_id`. Criar, só quando há
    -- anotação para abrigar.
    select id into v_conversa
      from conversations where account_id = p_conta and contact_id = v_contato;

    if jsonb_array_length(coalesce(v_grupo -> 'notas', '[]'::jsonb)) > 0 then
      if v_conversa is null then
        -- ⚠️ Nasce ENCERRADA e sem `last_message_at`: não aparece na aba
        -- "Abertas", vai para o fim da lista, e reabre sozinha quando o
        -- cliente escrever — com a anotação já lá esperando.
        insert into conversations (account_id, user_id, contact_id, status, created_at)
        values (p_conta, v_dono, v_contato, 'closed',
                coalesce((select min((n ->> 'em')::timestamptz)
                            from jsonb_array_elements(v_grupo -> 'notas') n), v_transacao))
        on conflict (account_id, contact_id) do nothing
        returning id into v_conversa;
        if v_conversa is null then
          select id into v_conversa
            from conversations where account_id = p_conta and contact_id = v_contato;
        else
          v_conversas := v_conversas + 1;
          v_escritas := v_escritas + 1;
          insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao)
          values (p_carga, p_lote, v_chave, 'conversations', v_conversa, 'criou');
        end if;
      end if;

      for v_nota in select value from jsonb_array_elements(v_grupo -> 'notas') loop
        -- ⚠️ `cb_conversation_notes` não tem restrição única nenhuma. O id
        -- DETERMINÍSTICO é o que impede a segunda passada de duplicar a
        -- anotação — e ele é derivado AQUI, não recebido, para não haver como
        -- esquecer.
        v_nota_id := md5('cb-kommo-nota:' || p_conta::text || ':' || (v_nota ->> 'kommo_note_id'))::uuid;
        insert into cb_conversation_notes
          (id, account_id, conversation_id, contact_id, author_user_id, autor_nome, texto, created_at)
        values (v_nota_id, p_conta, v_conversa, v_contato, null,
                v_nota ->> 'autor', v_nota ->> 'texto', (v_nota ->> 'em')::timestamptz)
        on conflict (id) do nothing;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_notas := v_notas + 1;
          v_escritas := v_escritas + 1;
          insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao)
          values (p_carga, p_lote, v_chave, 'cb_conversation_notes', v_nota_id, 'criou');
        end if;
      end loop;
    end if;

    -- ---- 2.6 o card -------------------------------------------------
    v_alvo := nullif(v_card ->> 'alvo_id', '')::uuid;
    v_status_final := coalesce(v_card ->> 'status_esperado', 'open');

    if v_alvo is null then
      -- Última linha de defesa: a passada de leitura já recusou este caso. Só
      -- chega aqui se DOIS grupos do MESMO lote pedirem card para a mesma
      -- pessoa no mesmo funil — bug do agrupamento, não estado do banco, e
      -- derruba o lote em vez de virar recusa silenciosa.
      if exists (
        select 1 from deals
         where account_id = p_conta and contact_id = v_contato
           and pipeline_id = (v_card ->> 'pipeline_id')::uuid
           and kommo_lead_id is null
      ) then
        raise exception 'carga kommo: lead % — a pessoa já tem card neste funil (dois grupos do mesmo lote para a mesma pessoa e área?)',
          v_chave;
      end if;

      -- ⚠️ Nenhum `UPDATE` depois: UM INSERT, já no estado FINAL (contrato
      -- B.6). `created_at` e `updated_at` explícitos — não há gatilho BEFORE
      -- INSERT que os reescreva, e o cabeçalho do Kanban conta "ganhos este
      -- mês" por `updated_at ?? created_at`.
      -- ⚠️ `titulo_fixado_em` NULO: o título segue a ficha (1007). Fixado, o
      -- rótulo de hoje congelaria para sempre.
      insert into deals (
        account_id, user_id, contact_id, conversation_id, pipeline_id, stage_id,
        title, value, status, source, assigned_to, titulo_fixado_em,
        created_at, updated_at, kommo_lead_id, kommo_atualizado_em
      ) values (
        p_conta, v_dono, v_contato, v_conversa,
        (v_card ->> 'pipeline_id')::uuid, (v_card ->> 'stage_id')::uuid,
        coalesce(v_nome, v_tel),
        coalesce((v_card ->> 'valor')::numeric, 0),
        v_status_final,
        'manual',       -- 'channel' bateria no índice da 911; 'automation' mentiria na trilha
        null,           -- nenhum responsável (decisão 12)
        null,
        (v_card ->> 'created_at')::timestamptz,
        coalesce((v_card ->> 'updated_at')::timestamptz, (v_card ->> 'created_at')::timestamptz),
        v_chave,
        nullif(v_card ->> 'kommo_atualizado_em', '')::timestamptz
      ) returning id into v_deal;

      v_criados := v_criados + 1;
      v_escritas := v_escritas + 1;
      v_gatilho_card := v_gatilho_card + 1;   -- 912/933 escrevem 1 `deal_created` cada
      insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao)
      values (p_carga, p_lote, v_chave, 'deals', v_deal, 'criou');
    else
      -- ⚠️ A etapa da Kommo MOVE o card que já existe aqui (decisão 11). O
      -- `alvo_id` já foi validado na passada de leitura; aqui só se lê o estado
      -- ANTERIOR, que é a única cópia que o desfazer terá.
      select jsonb_build_object(
               'pipeline_id', pipeline_id, 'stage_id', stage_id, 'status', status,
               'created_at', created_at, 'updated_at', updated_at,
               'kommo_lead_id', kommo_lead_id, 'kommo_atualizado_em', kommo_atualizado_em)
        into v_linha_antes
        from deals
       where id = v_alvo and account_id = p_conta
         and contact_id is not distinct from v_contato
         and kommo_lead_id is null;

      if v_linha_antes is null then
        raise exception 'carga kommo: lead % — o alvo_id % deixou de conferir entre a leitura e a escrita',
          v_chave, v_alvo;
      end if;

      v_deal := v_alvo;
      update deals
         set pipeline_id = (v_card ->> 'pipeline_id')::uuid,
             stage_id    = (v_card ->> 'stage_id')::uuid,
             status      = v_status_final,
             value       = coalesce((v_card ->> 'valor')::numeric, value),
             created_at  = (v_card ->> 'created_at')::timestamptz,
             kommo_lead_id = v_chave,
             kommo_atualizado_em = nullif(v_card ->> 'kommo_atualizado_em', '')::timestamptz
       where id = v_deal;

      -- Quantas linhas os gatilhos escrevem NESTE movimento: uma se funil ou
      -- etapa mudou, mais uma se o status mudou. É exatamente a regra dos dois
      -- gatilhos (912 e 933 contam igual), e é o que permite a afirmação exata.
      if (v_linha_antes ->> 'pipeline_id')::uuid is distinct from (v_card ->> 'pipeline_id')::uuid
         or (v_linha_antes ->> 'stage_id')::uuid is distinct from (v_card ->> 'stage_id')::uuid then
        v_gatilho_card := v_gatilho_card + 1;
      end if;
      if (v_linha_antes ->> 'status') is distinct from v_status_final then
        v_gatilho_card := v_gatilho_card + 1;
      end if;

      v_movidos := v_movidos + 1;
      v_escritas := v_escritas + 1;
      insert into migracao_kommo.linhas (carga_id, lote, kommo_lead_id, tabela, registro_id, acao, antes)
      values (p_carga, p_lote, v_chave, 'deals', v_deal, 'alterou', v_linha_antes);
    end if;

    v_cards := v_cards || v_deal;

    -- ⚠️⚠️ O gatilho da 950 é BEFORE e REESCREVE `NEW.status` a partir do
    -- `resultado` da etapa — ele VENCE o que a carga mandar. Conferir aqui é o
    -- que impede o de-para de mapear ganho/perdido para uma etapa cujo
    -- `resultado` diz outra coisa e ninguém perceber: o card ficaria `open`
    -- num funil de fechados, e o Desempenho contaria errado para sempre.
    select status into v_status_antes from deals where id = v_deal;
    if v_status_antes is distinct from v_status_final then
      raise exception 'carga kommo: lead % caiu em % mas a etapa carimbou % (o `resultado` da etapa e o de-para discordam)',
        v_chave, v_status_final, v_status_antes;
    end if;

    -- ---- 2.7 os eventos retroativos ---------------------------------
    v_ordem := 0;
    v_anterior := null;
    for v_item in select value from jsonb_array_elements(coalesce(v_grupo -> 'eventos', '[]'::jsonb)) loop
      -- C.12: o primeiro evento é SEMPRE o `deal_created`, e a data dele é a
      -- criação real do card — sem ele, os ~1.100 leads que nunca mudaram de
      -- etapa ficam invisíveis nas três vistas do funil.
      if v_ordem = 0 then
        if (v_item ->> 'tipo') is distinct from 'deal_created' then
          raise exception 'carga kommo: lead % — o primeiro evento tem de ser deal_created, veio %',
            v_chave, v_item ->> 'tipo';
        end if;
        if (v_item ->> 'em')::timestamptz is distinct from (v_card ->> 'created_at')::timestamptz then
          raise exception 'carga kommo: lead % — o deal_created (%) tem de ter a data de criação do card (%)',
            v_chave, v_item ->> 'em', v_card ->> 'created_at';
        end if;
      end if;

      -- C.13: sem `to_pipeline_id` o evento passa no CHECK e fica INVISÍVEL
      -- para o funil inteiro, em silêncio — a ficha do contato continua
      -- mostrando a história e as duas telas discordam sem nada ligando uma à
      -- outra.
      if (v_item ->> 'para_funil') is null or (v_item ->> 'para_etapa') is null then
        raise exception 'carga kommo: lead % — evento % sem para_funil/para_etapa (conferência 28)',
          v_chave, v_ordem;
      end if;

      -- C.14: entre FUNIS é `pipeline_changed`, nunca `stage_changed`. É o
      -- único tipo que `direcaoDoMovimento` recusa ler como avanço/retorno;
      -- escrito errado, a ficha compara a posição de uma etapa do comercial
      -- com a de outra do jurídico e afirma uma direção que não existe.
      if (v_item ->> 'tipo') = 'stage_changed'
         and (v_item ->> 'de_funil') is not null
         and (v_item ->> 'de_funil')::uuid is distinct from (v_item ->> 'para_funil')::uuid then
        raise exception 'carga kommo: lead % — movimento entre funis gravado como stage_changed (contrato C.14)',
          v_chave;
      end if;

      -- C.16: a Kommo carimba em SEGUNDOS e a RPC ordena por
      -- (occurred_at, id) — e `id` é uuid, não ordenável. Dois movimentos no
      -- mesmo instante sairiam em ordem sorteada.
      if v_anterior is not null and (v_item ->> 'em')::timestamptz <= v_anterior then
        raise exception 'carga kommo: lead % — evento % não avança no tempo (% <= %); falta o desempate em microssegundos',
          v_chave, v_ordem, v_item ->> 'em', v_anterior;
      end if;
      v_anterior := (v_item ->> 'em')::timestamptz;

      v_eventos := v_eventos || jsonb_build_object(
        'id', md5('cb-kommo-ev:' || p_conta::text || ':'
                  || coalesce(v_item ->> 'kommo_lead_id', v_chave::text) || ':'
                  || v_ordem::text)::uuid,
        'contato', v_contato, 'card', v_deal, 'conversa', v_conversa,
        'tipo', v_item ->> 'tipo', 'em', v_item ->> 'em',
        'de_funil', v_item ->> 'de_funil', 'para_funil', v_item ->> 'para_funil',
        'de_etapa', v_item ->> 'de_etapa', 'para_etapa', v_item ->> 'para_etapa',
        'kommo_lead_id', coalesce((v_item ->> 'kommo_lead_id')::bigint, v_chave));
      v_esperados := v_esperados + 1;
      v_ordem := v_ordem + 1;
    end loop;
  end loop;

  -- ==========================================================
  -- 3. Reparo — o que os GATILHOS escreveram neste lote
  -- ==========================================================
  -- ⚠️ As etiquetas vêm ANTES dos nossos eventos: o UPDATE abaixo é por
  -- `event_type`, mas rodar depois nos faria remarcar (e RE-DATAR) as nossas
  -- próprias linhas se um dia alguém mexesse no filtro.
  --
  -- A etiqueta é REMARCADA, não apagada: a Kommo não diz QUANDO a etiqueta foi
  -- aplicada, então não há versão retroativa para pôr no lugar — apagar
  -- deixaria a ficha sem registro nenhum de que a etiqueta veio da carga.
  -- `reconstructed = true` é a porta de saída do fio do cliente
  -- (`apareceNaConversa`), que é o que impede dezenas de milhares de "etiqueta
  -- aplicada hoje" de inundarem a conversa.
  update cb_lead_events
     set reconstructed = true,
         origin = 'retroativo',
         details = coalesce(details, '{}'::jsonb) || jsonb_build_object('carga', p_carga, 'lote', p_lote)
   where account_id = p_conta
     and event_type in ('tag_added', 'tag_removed')
     and contact_id = any(v_contatos)
     and created_at = v_transacao          -- cerca 1: esta transação
     and not (id = any(v_trilha_foto));    -- cerca 2: não existia antes do lote
  get diagnostics v_trilha_marcada = row_count;

  -- ⚠️⚠️ Os eventos de CARD são APAGADOS, não remarcados, e a razão é que a
  -- versão do gatilho está ERRADA no conteúdo, não só na data: o card é
  -- inserido JÁ no estado final (B.6), então o `deal_created` do gatilho
  -- aponta para a etapa FINAL, enquanto o retroativo aponta para a etapa
  -- INICIAL da Kommo. E o `stage_changed` do card movido é a última perna da
  -- trajetória que nós mesmos escrevemos logo abaixo — remarcá-lo a duplicaria.
  delete from cb_lead_events
   where account_id = p_conta
     and event_type = any(c_tipos_de_card)
     and deal_id = any(v_cards)
     and created_at = v_transacao
     and not (id = any(v_trilha_foto));
  get diagnostics v_trilha_apagada = row_count;

  -- A fila da 933, pelo mesmo par de cercas (contrato A.17). Recorte por ID,
  -- nunca por janela de tempo: um `deal_stage_changed` do Calendly que caia na
  -- janela seria apagado junto, e é essa tabela que `cardSaiuDaEtapa` consulta.
  delete from cb_automation_events
   where account_id = p_conta
     and deal_id = any(v_cards)
     and criado_em = v_transacao
     and not (id = any(v_fila_foto));
  get diagnostics v_fila_apagada = row_count;

  -- ⚠️⚠️ AS AFIRMAÇÕES EXATAS. É aqui que o buraco do "escritor concorrente"
  -- se fecha: sabemos quantas linhas os gatilhos DEVEM ter escrito (uma por
  -- card criado; uma por movimento; mais uma quando o status mudou; uma por
  -- etiqueta inserida) e exigimos exatamente isso. Uma etiqueta aplicada por
  -- gente no mesmo microssegundo, num contato deste lote, faria a conta dar
  -- diferente — e o lote cai em vez de datar a ação dela com a data da Kommo.
  if v_trilha_marcada <> v_etiquetas then
    raise exception 'carga kommo: remarquei % eventos de etiqueta mas inseri % etiquetas — escrita concorrente neste lote; repita o lote',
      v_trilha_marcada, v_etiquetas;
  end if;
  if v_trilha_apagada <> v_gatilho_card then
    raise exception 'carga kommo: apaguei % eventos de card mas os gatilhos deviam ter escrito % — escrita concorrente neste lote; repita o lote',
      v_trilha_apagada, v_gatilho_card;
  end if;
  if v_fila_apagada <> v_gatilho_card then
    raise exception 'carga kommo: apaguei % linhas de fila mas os gatilhos deviam ter escrito % — escrita concorrente neste lote; repita o lote',
      v_fila_apagada, v_gatilho_card;
  end if;

  -- ==========================================================
  -- 4. Os eventos retroativos (DEPOIS do reparo)
  -- ==========================================================
  if jsonb_array_length(v_eventos) > 0 then
    -- ⚠️ `cb_lead_events` não tem FK para etapa nem para funil: um id que não
    -- existe ENTRA no banco e a trajetória some das três vistas do funil, em
    -- silêncio. Aqui é o único lugar que pode barrar isso.
    if exists (
      select 1
        from jsonb_to_recordset(v_eventos) as e(de_funil uuid, para_funil uuid, de_etapa uuid, para_etapa uuid)
       where (e.para_funil is not null and not exists (select 1 from pipelines p where p.id = e.para_funil and p.account_id = p_conta))
          or (e.de_funil   is not null and not exists (select 1 from pipelines p where p.id = e.de_funil   and p.account_id = p_conta))
          or (e.para_etapa is not null and not exists (select 1 from pipeline_stages s where s.id = e.para_etapa))
          or (e.de_etapa   is not null and not exists (select 1 from pipeline_stages s where s.id = e.de_etapa))
    ) then
      raise exception 'carga kommo: há evento apontando para funil/etapa que não existe nesta conta';
    end if;

    insert into cb_lead_events (
      id, account_id, contact_id, contact_label, deal_id, conversation_id,
      event_type, occurred_at, actor_user_id, actor_label, origin, reconstructed,
      from_pipeline_id, from_pipeline_label, to_pipeline_id, to_pipeline_label,
      from_stage_id, from_stage_label, from_stage_position,
      to_stage_id, to_stage_label, to_stage_position, details
    )
    select
      e.id, p_conta, e.contato, coalesce(nullif(c.name, ''), c.phone), e.card, e.conversa,
      e.tipo, e.em, null, null, 'retroativo', true,
      e.de_funil, pde.name, e.para_funil, ppara.name,
      e.de_etapa, sde.name, sde.position,
      e.para_etapa, spara.name, spara.position,
      jsonb_build_object('kommo_lead_id', e.kommo_lead_id, 'carga', p_carga, 'lote', p_lote)
    from jsonb_to_recordset(v_eventos) as e(
      id uuid, contato uuid, card uuid, conversa uuid, tipo text, em timestamptz,
      de_funil uuid, para_funil uuid, de_etapa uuid, para_etapa uuid, kommo_lead_id bigint)
    left join contacts c on c.id = e.contato
    left join pipelines pde on pde.id = e.de_funil
    left join pipelines ppara on ppara.id = e.para_funil
    left join pipeline_stages sde on sde.id = e.de_etapa
    left join pipeline_stages spara on spara.id = e.para_etapa
    -- ⚠️ O id é DETERMINÍSTICO (conta + lead da Kommo + ordem no histórico
    -- daquele lead): é a segunda linha de defesa da idempotência, a que não
    -- depende de o pulo do grupo ter acertado. Cobre também os 76 leads
    -- FUNDIDOS, que não têm card próprio e por isso não têm `kommo_lead_id` em
    -- `deals` para responder por eles.
    on conflict (id) do nothing;
    get diagnostics v_ev_inseridos = row_count;
    v_escritas := v_escritas + v_ev_inseridos;

    if v_ev_inseridos <> v_esperados then
      raise exception 'carga kommo: % eventos esperados, % inseridos — há (lead, ordem) repetido no lote',
        v_esperados, v_ev_inseridos;
    end if;
  end if;

  -- ==========================================================
  -- 5. Afirmação final — e ela NÃO repete a cerca do reparo
  -- ==========================================================
  -- ⚠️⚠️ ESTA é a que impede o erro do `xmin` de se repetir. Se
  -- `created_at = now()` estiver errado, o reparo acima não repara NADA — e um
  -- teste escrito com o MESMO predicado passaria vazio, exatamente como o
  -- teste do xmin passou. Por isso aqui só entram a FOTO e o `reconstructed`:
  -- os nossos retroativos são `true`, o que já existia está na foto, e o que
  -- sobrar é linha de gatilho que o reparo não alcançou.
  select count(*) into v_n
    from cb_lead_events
   where account_id = p_conta
     and reconstructed = false
     and (deal_id = any(v_cards) or contact_id = any(v_contatos))
     and not (id = any(v_trilha_foto));
  if v_n > 0 then
    raise exception 'carga kommo: sobraram % linhas de trilha não reparadas neste lote — o reparo não alcançou o que os gatilhos escreveram', v_n;
  end if;

  select count(*) into v_n
    from cb_automation_events
   where account_id = p_conta
     and deal_id = any(v_cards)
     and not (id = any(v_fila_foto));
  if v_n > 0 then
    raise exception 'carga kommo: sobraram % eventos na fila de automação deste lote (contrato A.17)', v_n;
  end if;

  -- ==========================================================
  -- 6. Fecha o lote no livro e devolve
  -- ==========================================================
  update migracao_kommo.cargas
     set lotes = lotes + 1,
         ultimo_lote_em = clock_timestamp(),
         grupos_recebidos = grupos_recebidos + jsonb_array_length(p_grupos),
         cards_criados = cards_criados + v_criados,
         cards_movidos = cards_movidos + v_movidos,
         grupos_pulados = grupos_pulados + v_pulados,
         grupos_recusados = grupos_recusados + jsonb_array_length(v_recusados)
   where id = p_carga;

  return jsonb_build_object(
    'carga', p_carga, 'lote', p_lote,
    'recebidos', jsonb_array_length(p_grupos),
    'cards_criados', v_criados,
    'cards_movidos', v_movidos,
    'grupos_pulados', v_pulados,
    'recusados', v_recusados,
    'contatos_criados', v_cont_criados,
    'contatos_alterados', v_cont_alterados,
    'etiquetas', v_etiquetas,
    'campos', v_campos,
    'conversas', v_conversas,
    'notas', v_notas,
    'eventos_retroativos', v_ev_inseridos,
    'trilha_apagada', v_trilha_apagada,
    'trilha_remarcada', v_trilha_marcada,
    'fila_apagada', v_fila_apagada,
    -- ⚠️ A PROVA DO PILOTO: a segunda passada tem de devolver 0 aqui.
    'escritas', v_escritas
  );
end;
$funcao$;

comment on function public.cb_kommo_carregar_lote(uuid, uuid, text, integer, jsonb) is
  'Carga da Kommo, um lote por chamada: escreve, repara a trilha dos gatilhos e '
  'limpa a fila de automação na MESMA transação. Idempotente por lote.';

-- ⚠️ EXECUTE nasce concedido a PUBLIC; fechar exige as DUAS metades (lição da
-- 913/915), e o REVOKE de PUBLIC leva o service_role junto — devolver por
-- escrito, que também é a regra do banco vazio.
revoke execute on function public.cb_kommo_carregar_lote(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.cb_kommo_carregar_lote(uuid, uuid, text, integer, jsonb)
  to service_role;

-- ------------------------------------------------------------
-- 4) O plano de desfazer — uma VISÃO, nunca uma função que apaga
-- ------------------------------------------------------------
-- ⚠️ De propósito NÃO existe `cb_kommo_desfazer_lote()`. Uma função que apaga
-- contato é uma arma carregada: `contacts` cascateia em `conversations` e, por
-- ela, em TODAS as mensagens. O desfazer é um script revisado a cada uso, e
-- esta visão é o plano que ele executa — ela só LÊ, e por isso pode ser
-- ensaiada quantas vezes se quiser antes do piloto.
--
-- A ordem é a da receita de fusão do CLAUDE.md: apagar o negócio
-- EXPLICITAMENTE antes do contato.
create or replace view migracao_kommo.desfazer as
select
  l.carga_id, l.lote, l.kommo_lead_id, l.tabela, l.registro_id, l.acao, l.antes, l.criado_em,
  case l.tabela
    when 'cb_conversation_notes'   then 1
    when 'contact_custom_values'   then 2
    when 'contact_tags'            then 3
    when 'deals'                   then 4
    when 'conversations'           then 5
    when 'contacts'                then 6
  end as ordem,
  -- ⚠️ O que NÃO pode ser desfeito às cegas. Entre a carga e o desfazer o
  -- cliente pode ter escrito: apagar a conversa levaria as mensagens junto, e
  -- apagar o contato levaria conversa e mensagens. Estas linhas saem do plano
  -- e viram lista para o operador.
  case
    when l.acao <> 'criou' then null
    when l.tabela = 'conversations' and exists (
      select 1 from public.messages m where m.conversation_id = l.registro_id
    ) then 'a conversa recebeu mensagem depois da carga'
    when l.tabela = 'contacts' and exists (
      select 1 from public.conversations c
       join public.messages m on m.conversation_id = c.id
      where c.contact_id = l.registro_id
    ) then 'o contato recebeu mensagem depois da carga'
    when l.tabela = 'deals' and exists (
      select 1 from public.cb_lead_events e
       where e.deal_id = l.registro_id
         and e.reconstructed = false
         and e.occurred_at > l.criado_em
    ) then 'o card foi mexido por gente depois da carga'
  end as impedimento
from migracao_kommo.linhas l
where l.acao in ('criou', 'alterou');

revoke all on migracao_kommo.desfazer from public, anon, authenticated;
grant select on migracao_kommo.desfazer to service_role;

comment on view migracao_kommo.desfazer is
  'O plano de desfazer, em ordem crescente de `ordem`. `impedimento` não nulo = '
  'linha que o script deve PULAR e reportar, nunca apagar.';

-- ⚠️ Ao fim da migração (fase 8), depois de a janela de desfazer fechar:
--   DROP SCHEMA migracao_kommo CASCADE;
-- `deals.kommo_lead_id` e `kommo_atualizado_em` FICAM — são procedência.

-- ------------------------------------------------------------
-- 5) Conferência
-- ------------------------------------------------------------
-- Roda como DONO, então prova FORMA e PRIVILÉGIO, nunca dado — e afirma
-- ausência, nunca presença (regra do banco vazio, CLAUDE.md).
do $conferencia$
declare
  v_n integer;
begin
  if to_regclass('migracao_kommo.cargas') is null
     or to_regclass('migracao_kommo.linhas') is null then
    raise exception '1013: as tabelas do livro-razão não foram criadas';
  end if;

  -- ⚠️ A barreira principal é o SCHEMA: o PostgREST expõe `public`, e o que
  -- não está lá não tem URL. Conferir os dois lados, porque um `GRANT ... ON
  -- ALL TABLES IN SCHEMA public` futuro não pode alcançar o livro.
  if has_schema_privilege('anon', 'migracao_kommo', 'USAGE')
     or has_schema_privilege('authenticated', 'migracao_kommo', 'USAGE') then
    raise exception '1013: o schema da carga está acessível ao navegador';
  end if;
  if has_table_privilege('anon', 'migracao_kommo.linhas', 'SELECT')
     or has_table_privilege('authenticated', 'migracao_kommo.linhas', 'SELECT') then
    raise exception '1013: o livro-razão está legível pelo navegador';
  end if;
  if not has_table_privilege('service_role', 'migracao_kommo.linhas', 'INSERT') then
    raise exception '1013: service_role perdeu o INSERT no livro-razão';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'migracao_kommo' and tablename in ('cargas', 'linhas');
  if v_n <> 0 then
    raise exception '1013: o livro-razão não pode ter policy — ele guarda nome e e-mail em `antes` (% encontradas)', v_n;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'migracao_kommo' and c.relname = 'linhas' and c.relrowsecurity
  ) then
    raise exception '1013: RLS desligada em migracao_kommo.linhas';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cb_kommo_carregar_lote' and p.prosecdef
  ) then
    raise exception '1013: cb_kommo_carregar_lote ausente ou não é SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_lote(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_carregar_lote(uuid,uuid,text,integer,jsonb)', 'EXECUTE') then
    raise exception '1013: a função de carga está executável pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_lote(uuid,uuid,text,integer,jsonb)', 'EXECUTE') then
    raise exception '1013: service_role perdeu o EXECUTE da função de carga (o REVOKE de PUBLIC leva o service_role junto)';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'deals' and column_name = 'kommo_atualizado_em'
  ) then
    raise exception '1013: deals.kommo_atualizado_em ausente';
  end if;

  raise notice '1013: schema, livro-razão, função de lote, visão de desfazer e privilégios conferidos.';
end
$conferencia$;
