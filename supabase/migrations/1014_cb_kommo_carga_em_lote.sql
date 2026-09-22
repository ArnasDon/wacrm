-- ============================================================
-- 1014 — A carga da Kommo: o LIVRO-RAZÃO e a FUNÇÃO DE LOTE.
--
-- O contrato A.1 (`docs/PLANO-migracao-kommo.md`) fecha a mecânica: a carga
-- escreve por LOTE, por uma função no banco, porque as duas formas óbvias
-- estão erradas em direções opostas — o PostgREST não tem transação de várias
-- instruções, e uma transação única para tudo estoura o cache de
-- subtransações e degrada o CRM inteiro, sem erro e sem log.
--
-- ⚠️⚠️ POR QUE OS GATILHOS SÃO DESLIGADOS, E NÃO A TRILHA REPARADA
--
-- O contrato deixou quatro saídas e mandou quem projetasse escolher. Medido
-- contra a produção em 20–21/09/2026:
--
--  (a) anti-join dos ids que já existiam  → repara certo, mas...
--  (b) piso de tempo por clock_timestamp() → ...os dois deixam TRÊS defeitos
--  (c) ALTER TABLE ... DISABLE TRIGGER USER  ← ESCOLHIDA
--  (d) session_replication_role = 'replica'  → derruba as FKs junto
--
-- Os três defeitos que (a) e (b) não resolvem:
--
--  1. ⚠️⚠️ `updated_at` fica IMPOSSÍVEL nos ~1.150 cards MOVIDOS.
--     `set_updated_at` é BEFORE UPDATE **sem lista de colunas** e faz
--     `NEW.updated_at = now()` em qualquer escrita. MEDIDO: pedindo
--     '2024-03-15', com o gatilho ligado a coluna ficou '2026-09-21'; com ele
--     desligado, ficou '2024-03-15' exato. A regra 8 do contrato exige a data
--     da Kommo, e o cabeçalho do Kanban conta "ganhos/perdidos este mês" por
--     `updated_at`. Reparar `cb_lead_events` não toca nisso.
--  2. O estouro de subtransação continua: QUATRO dos seis gatilhos de `deals`
--     têm bloco EXCEPTION, e por operação são DOIS (INSERT dispara dois;
--     UPDATE, os outros dois). Com o cache de 64 subxids o estouro é por
--     volta da 32ª linha do lote, e daí toda leitura concorrente do banco
--     paga SLRU por tupla até o commit.
--  3. Sobra a fila `cb_automation_events` para apagar, e o recorte por
--     `deal_id` alcança evento legítimo pendente daquele card.
--
-- E as duas ainda deixam uma JANELA DE CONTAMINAÇÃO: a foto do "antes" é
-- tirada antes da escrita, e nada impede outra sessão de gravar um `tag_added`
-- legítimo para um contato do lote nesse meio — que viraria `retroativo` e
-- `reconstructed = true`, sumindo do fio do cliente. Com os gatilhos
-- silenciados não existe linha nova para classificar: a janela não existe.
--
-- ⚠️⚠️ E A OBJEÇÃO ÓBVIA AO (c) NÃO SE SUSTENTA — MEDIDO.
-- "Se a carga morrer entre o DISABLE e o ENABLE, o CRM fica sem os gatilhos,
-- em silêncio." `ALTER TABLE ... DISABLE TRIGGER` é **DDL TRANSACIONAL**: um
-- bloco que desliga os seis gatilhos de `deals` e termina em `RAISE` deixa os
-- sete (contando `contact_tags`) de volta em 'ligado'. Não existe estado
-- "desligado e esquecido" enquanto o DISABLE estiver DENTRO do lote — e é por
-- isso que ele está aqui dentro, e não num passo separado da carga.
--
-- A trava é `ShareRowExclusiveLock`, não `ACCESS EXCLUSIVE` (medido): leitor
-- concorrente NÃO espera; escritor de `deals` espera o lote terminar. Com
-- lotes curtos é uma pausa, não uma perda — o CRM enfileira e escreve depois,
-- com trilha e fila normais. As FKs continuam de pé: elas são gatilhos
-- INTERNOS, e `DISABLE TRIGGER USER` não os toca (ao contrário do modo
-- replica, que as derruba junto — medido).
--
-- ⚠️ O PREÇO, ESCRITO: com os gatilhos calados, a carga passa a DEVER
-- escrever à mão o que eles faziam — o `status` a partir do `resultado` da
-- etapa (o que a 950 fazia), o `updated_at`, e a trilha retroativa. É o que
-- se quer: escrita certa de primeira, em vez de escrita errada e remendada.
--
-- ⚠️ O QUE ESTA FUNÇÃO **NÃO** FAZ: contato, campo personalizado, conversa e
-- anotação. Eles vão pelo caminho normal do PostgREST, antes do lote de
-- cards, porque precisam dos gatilhos LIGADOS — o espelho de e-mail da
-- 1000/1001 é gatilho, e silenciá-lo deixaria os e-mails sem espelho. Esta
-- função recebe o `contact_id` JÁ RESOLVIDO.
--
-- ⚠️⚠️ E RESOLVER O CONTATO É DA CARGA, PELA RÉGUA DO NONO DÍGITO — nunca por
-- igualdade de `phone_normalized`. Medido em 21/09: dos 13.046 telefones
-- distintos da Kommo, 821 casam com uma ficha daqui por igualdade e OUTROS
-- 320 casam só pela variante ('553170000006' lá é '5531970000006' aqui, a
-- mesma pessoa). Resolver por igualdade cria 320 fichas novas para clientes
-- que já estão no CRM. Esta função não tem como conferir isso — ela só
-- recusa contato de outra conta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O livro-razão, num schema que o PostgREST NÃO expõe.
--
-- ⚠️⚠️ NUNCA em `public`. `CREATE TABLE` ali herda a concessão padrão do
-- Supabase para anon/authenticated e nasce SEM RLS — este livro guarda id de
-- contato e de negócio da conta inteira, e ficaria legível do navegador. É o
-- mesmo buraco que a 901, a 906 e a 912 abriram e que a 931 fechou.
-- ------------------------------------------------------------
create schema if not exists migracao_kommo;
revoke all on schema migracao_kommo from public;
revoke all on schema migracao_kommo from anon, authenticated;
grant usage on schema migracao_kommo to service_role;

create table if not exists migracao_kommo.livro_razao (
  id             bigint generated always as identity primary key,
  account_id     uuid not null,
  -- O lead da Kommo que originou a linha. Nulo em linha que não vem de lead
  -- (uma etiqueta aplicada em lote, por exemplo).
  kommo_lead_id  bigint,
  -- 'criou' → desfazer é APAGAR a linha.
  -- 'alterou' → desfazer é DEVOLVER `antes`.
  acao           text not null check (acao in ('criou', 'alterou')),
  tabela         text not null,
  registro_id    uuid not null,
  -- O estado ANTERIOR, só em 'alterou'. Em 'criou' é nulo: não havia nada.
  -- ⚠️ O CHECK amarra os dois, senão um 'alterou' sem `antes` entra no livro
  -- e o desfazer não tem o que devolver — descobriria isso na hora de usar.
  antes          jsonb,
  -- ⚠️⚠️ Chave COMPLEMENTAR, para a tabela cuja identidade não cabe num uuid
  -- só. `contact_tags` é identificada por (contact_id, tag_id): guardando só
  -- o contato, o desfazer não sabe QUAL etiqueta tirar — e tirar todas
  -- apagaria as que o escritório aplicou à mão. Achado ao escrever o
  -- desfazer, antes de a 1014 ser aplicada.
  detalhe        jsonb,
  criado_em      timestamptz not null default now(),
  constraint livro_razao_antes_ck check ((acao = 'alterou') = (antes is not null))
);

create index if not exists livro_razao_conta_idx
  on migracao_kommo.livro_razao (account_id, id);
create index if not exists livro_razao_lead_idx
  on migracao_kommo.livro_razao (account_id, kommo_lead_id)
  where kommo_lead_id is not null;

revoke all on table migracao_kommo.livro_razao from public;
revoke all on table migracao_kommo.livro_razao from anon, authenticated;
grant select, insert, update, delete on table migracao_kommo.livro_razao to service_role;

-- ------------------------------------------------------------
-- 2. A função de lote.
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
  -- ---------- guardas de entrada ----------
  if p_account_id is null then
    raise exception 'cb_kommo_carregar_lote: p_account_id é obrigatório';
  end if;
  if p_grupos is null or jsonb_typeof(p_grupos) <> 'array' then
    raise exception 'cb_kommo_carregar_lote: p_grupos tem de ser um array jsonb (veio %)',
      coalesce(jsonb_typeof(p_grupos), 'null');
  end if;

  -- ⚠️ O dono DURÁVEL, e sem queda: `contacts.user_id`, `conversations.user_id`
  -- e `custom_fields.user_id` cascateiam de `auth.users`, e apagar o login de
  -- quem rodou a carga (o passo normal de offboarding) levaria os contatos, as
  -- conversas e as mensagens junto.
  select owner_user_id into v_dono from accounts where id = p_account_id;
  if v_dono is null then
    raise exception 'cb_kommo_carregar_lote: conta % não existe ou está sem owner_user_id',
      p_account_id;
  end if;

  -- ---------- conferência de forma, ANTES de escrever ou desligar nada ----------
  -- Roda sempre: com `p_conferir` ela é o resultado; sem, ela é o pré-voo. O
  -- lote inteiro é recusado se qualquer grupo estiver malformado — um lote
  -- pela metade é pior que um lote recusado, porque a reexecução tem de
  -- descobrir onde parou.
  for v_grupo in select * from jsonb_array_elements(p_grupos) loop
    v_lead    := (v_grupo->>'kommo_lead_id')::bigint;
    v_contato := (v_grupo->>'contact_id')::uuid;
    v_funil   := (v_grupo->>'pipeline_id')::uuid;
    v_etapa   := (v_grupo->>'stage_id')::uuid;

    if v_lead is null then
      raise exception 'grupo sem kommo_lead_id: %', v_grupo;
    end if;
    -- ⚠️ Card sem contato é DESENHADO EM BRANCO no Kanban e não abre conversa
    -- nenhuma (a armadilha do roteador de grupo, no CLAUDE.md). A regra 18b
    -- manda a carga PULAR o lead sem telefone; se um chegou aqui, é defeito
    -- do script e o lote para.
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

    -- ⚠️ `pipeline_stages` NÃO tem `account_id` (conferido no catálogo em
    -- 21/09; só `pipelines` tem). O recorte por conta passa por `pipelines`,
    -- e escrever `s.account_id` aqui daria 42703.
    if not exists (
      select 1 from pipeline_stages s
        join pipelines p on p.id = s.pipeline_id
       where s.id = v_etapa and s.pipeline_id = v_funil and p.account_id = p_account_id
    ) then
      raise exception 'lead %: o par (etapa %, funil %) não existe nesta conta', v_lead, v_etapa, v_funil;
    end if;

    -- As etiquetas têm de ser desta conta também.
    for v_tag in select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_grupo->'etiquetas', '[]'::jsonb)) loop
      if not exists (select 1 from tags t where t.id = v_tag and t.account_id = p_account_id) then
        raise exception 'lead %: etiqueta % não é desta conta', v_lead, v_tag;
      end if;
    end loop;

    -- ⚠️ A forma do evento é conferida AQUI porque as CHECKs de
    -- `cb_lead_events` são POR `event_type` (912) e estouram no meio do lote,
    -- sem dizer de qual lead vieram.
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
          -- ⚠️ A CHECK da 912 exige os DOIS funis E que sejam DIFERENTES.
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
          -- Allowlist: tipo que esta função não sabe montar não entra "quase
          -- certo" — para o lote e é decidido por escrito.
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

  -- ---------- os gatilhos calam, DENTRO desta transação ----------
  -- ⚠️ Se qualquer coisa abaixo estourar, o rollback religa sozinho: é DDL
  -- transacional, e foi medido. Não há passo de "religar" a cumprir fora daqui.
  alter table public.deals        disable trigger user;
  alter table public.contact_tags disable trigger user;

  for v_grupo in select * from jsonb_array_elements(p_grupos) loop
    v_lead    := (v_grupo->>'kommo_lead_id')::bigint;
    v_contato := (v_grupo->>'contact_id')::uuid;
    v_funil   := (v_grupo->>'pipeline_id')::uuid;
    v_etapa   := (v_grupo->>'stage_id')::uuid;

    -- ---------- idempotência, GARANTIDA PELO BANCO (1012) ----------
    -- ⚠️ O grupo INTEIRO é pulado, eventos fundidos inclusive: os leads
    -- extras fundidos (os 76) não têm `kommo_lead_id` próprio porque não têm
    -- card, e `cb_lead_events` não tem restrição única — reexecutar
    -- duplicaria os eventos deles em silêncio (contrato C.17).
    select id into v_card
      from deals
     where account_id = p_account_id and kommo_lead_id = v_lead;
    if found then
      v_pulados := v_pulados || jsonb_build_object('kommo_lead_id', v_lead, 'motivo', 'ja_migrado');
      continue;
    end if;

    -- ---------- o status, que a 950 carimbaria ----------
    select s.resultado into v_resultado from pipeline_stages s where s.id = v_etapa;
    v_status := case v_resultado
                  when 'ganho'   then 'won'
                  when 'perdido' then 'lost'
                  else coalesce(v_grupo->>'status', 'open')
                end;

    v_card := nullif(v_grupo->>'deal_id', '')::uuid;

    if v_card is null then
      -- ---------- card NOVO ----------
      insert into deals (
        account_id, user_id, contact_id, pipeline_id, stage_id,
        title, value, status, source, kommo_lead_id, created_at, updated_at
      ) values (
        p_account_id, v_dono, v_contato, v_funil, v_etapa,
        coalesce(nullif(v_grupo->>'title', ''), 'Novo contato'),
        nullif(v_grupo->>'value', '')::numeric,
        v_status,
        -- ⚠️ 'manual': 'channel' ativaria o índice único parcial da 911 e daria
        -- 23505 nos contatos que já têm card; 'automation' gravaria
        -- procedência falsa na trilha.
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
      -- ---------- card que JÁ EXISTE aqui: MOVER (decisão 11) ----------
      select to_jsonb(d) - 'title' into v_antes
        from deals d where d.id = v_card and d.account_id = p_account_id;
      if v_antes is null then
        v_pulados := v_pulados || jsonb_build_object('kommo_lead_id', v_lead, 'motivo', 'card_sumiu');
        continue;
      end if;

      -- ⚠️ UM update só, com funil e etapa juntos: em dois updates a trilha
      -- contaria que o lead saiu e voltou (912). Aqui os gatilhos estão
      -- calados, mas a regra fica porque a função pode um dia rodar com eles.
      update deals
         set pipeline_id   = v_funil,
             stage_id      = v_etapa,
             status        = v_status,
             kommo_lead_id = v_lead,
             -- ⚠️ A data da Kommo. Só é possível porque `set_updated_at` está
             -- calado — com ele ligado isto vira now(), medido.
             updated_at    = coalesce((v_grupo->>'updated_at')::timestamptz, updated_at),
             value         = coalesce(nullif(v_grupo->>'value', '')::numeric, value)
       where id = v_card and account_id = p_account_id;

      insert into migracao_kommo.livro_razao (account_id, kommo_lead_id, acao, tabela, registro_id, antes)
      values (p_account_id, v_lead, 'alterou', 'deals', v_card, v_antes);
      v_movidos := v_movidos + 1;
    end if;

    -- ---------- a trilha, retroativa e já certa ----------
    -- ⚠️ `origin = 'retroativo'` e `reconstructed = true`: é o segundo que
    -- tira a linha do fio do cliente (`apareceNaConversa`). Sem ele, 28 mil
    -- eventos de meses atrás apareceriam na conversa de cada cliente.
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
        -- A procedência de CADA lead, inclusive a dos fundidos, que não têm
        -- card próprio e só são rastreáveis por aqui.
        jsonb_build_object('kommo_lead_id', coalesce((v_evento->>'kommo_lead_id')::bigint, v_lead))
      );
      v_eventos := v_eventos + 1;
    end loop;

    -- ---------- etiquetas ----------
    -- ⚠️ INSERT direto, nunca `tag-events.ts`: aquele caminho dispara o
    -- gatilho das AUTOMAÇÕES. Aqui o gatilho de auditoria também está calado,
    -- então não nascem as dezenas de milhares de `tag_added` datados de hoje.
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

  -- ---------- provas, ainda DENTRO da transação ----------
  -- Falhar aqui desfaz o lote inteiro, que é o que se quer: melhor um lote
  -- recusado que um lote com lixo.
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
-- 2b. O DESFAZER — ler o livro-razão de trás para frente.
--
-- ⚠️ O piloto só pode rodar depois que ISTO existir e tiver sido ensaiado: é
-- a diferença entre "testar em produção" e "testar em produção com volta".
--
-- ⚠️⚠️ Os gatilhos calam AQUI TAMBÉM, e por um motivo próprio: apagar um card
-- com o gatilho da 912 ligado escreve um `deal_deleted` — e desfazer não pode
-- deixar rastro de que houve carga. O mesmo DDL transacional da carga vale
-- aqui: se o desfazer morrer no meio, o rollback religa tudo.
--
-- ⚠️⚠️ `cb_lead_events.deal_id` NÃO TEM chave estrangeira (912, e é decisão
-- escrita lá). Apagar o card NÃO leva a trilha dele junto: se o desfazer não
-- apagar explicitamente, ficam eventos órfãos apontando para card que não
-- existe — invisíveis no funil e vivos na ficha do contato.
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

  -- ⚠️ DESC: desfazer é a carga ao contrário. Uma etiqueta aplicada depois do
  -- card tem de sair antes de o card sair.
  for v_linha in
    select * from migracao_kommo.livro_razao
     where account_id = p_account_id
       and (p_desde_id is null or id >= p_desde_id)
     order by id desc
  loop
    if v_linha.tabela = 'deals' and v_linha.acao = 'criou' then
      -- A trilha SAI ANTES do card: sem FK, apagar o card deixaria órfã.
      delete from cb_lead_events
       where account_id = p_account_id and deal_id = v_linha.registro_id;
      get diagnostics v_n = row_count; v_eventos := v_eventos + v_n;

      delete from deals
       where id = v_linha.registro_id and account_id = p_account_id;
      get diagnostics v_n = row_count; v_cards := v_cards + v_n;

    elsif v_linha.tabela = 'deals' and v_linha.acao = 'alterou' then
      -- ⚠️ Só a trilha que ESTA carga escreveu: o card movido já existia e
      -- tem trilha nossa, de meses atrás. O recorte é a procedência gravada
      -- em `details`, que só a carga põe.
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
             value         = nullif(v_linha.antes->>'value', '')::numeric,
             kommo_lead_id = nullif(v_linha.antes->>'kommo_lead_id', '')::bigint,
             updated_at    = (v_linha.antes->>'updated_at')::timestamptz
       where d.id = v_linha.registro_id and d.account_id = p_account_id;
      get diagnostics v_n = row_count; v_alterados := v_alterados + v_n;

    elsif v_linha.tabela = 'contact_tags' and v_linha.acao = 'criou' then
      -- ⚠️ Pelo PAR. Sem o `tag_id` do `detalhe`, tirar "as etiquetas do
      -- contato" levaria junto as que o escritório aplicou à mão.
      delete from contact_tags
       where contact_id = v_linha.registro_id
         and tag_id = (v_linha.detalhe->>'tag_id')::uuid;
      get diagnostics v_n = row_count; v_etiquetas := v_etiquetas + v_n;

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

  -- Prova: não sobrou card da carga nem evento órfão dela.
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
    'eventos',    v_eventos
  );
end;
$desfazer$;

-- ------------------------------------------------------------
-- 3. Privilégio: as DUAS metades do REVOKE, e o GRANT de volta.
--
-- ⚠️ `REVOKE ... FROM PUBLIC` sozinho não tira nada quando a concessão é
-- explícita por papel, e `FROM anon, authenticated` sozinho não tira nada
-- quando ela vem de PUBLIC — a forma varia por função, conforme o
-- ALTER DEFAULT PRIVILEGES que valia quando ela nasceu. Este erro já foi
-- cometido três vezes neste repositório (903, 912, 914). Escreva as duas.
--
-- ⚠️ E o GRANT de volta não é zelo: em Postgres o EXECUTE de função nasce
-- concedido a PUBLIC, então o REVOKE tira também do `service_role` — que é
-- justamente quem a carga usa. Sem ele a migration aplica num banco vazio e
-- a carga leva 42501 na primeira chamada.
-- ------------------------------------------------------------
revoke execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_carregar_lote(uuid, jsonb, boolean)
  to service_role;

revoke execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_kommo_desfazer(uuid, bigint, boolean)
  to service_role;

-- ------------------------------------------------------------
-- 4. Conferência. NÃO exige dado que só existe nesta instalação: o CI
--    reaplica tudo num banco vazio, e conferência que precise de linha
--    reprova lá por falta de dado, não por defeito.
-- ------------------------------------------------------------
do $conferir$
declare
  v_texto text;
begin
  if to_regprocedure('public.cb_kommo_carregar_lote(uuid, jsonb, boolean)') is null then
    raise exception '1014: a função não foi criada';
  end if;

  if has_function_privilege('anon', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1014: anon ainda pode executar a função de carga';
  end if;
  if has_function_privilege('authenticated', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1014: authenticated ainda pode executar a função de carga';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)', 'EXECUTE') then
    raise exception '1014: service_role PERDEU o execute — a carga não roda';
  end if;

  -- SECURITY DEFINER é load-bearing: ele é o dono do `ALTER TABLE`.
  select prosecdef::text into v_texto from pg_proc
   where oid = 'public.cb_kommo_carregar_lote(uuid, jsonb, boolean)'::regprocedure;
  if v_texto <> 'true' then
    raise exception '1014: a função tem de ser SECURITY DEFINER (é ela que desliga os gatilhos)';
  end if;

  -- O livro-razão existe e está FECHADO ao navegador.
  if to_regclass('migracao_kommo.livro_razao') is null then
    raise exception '1014: o livro-razão não foi criado';
  end if;
  if has_table_privilege('anon', 'migracao_kommo.livro_razao', 'SELECT')
     or has_table_privilege('authenticated', 'migracao_kommo.livro_razao', 'SELECT') then
    raise exception '1014: o livro-razão está legível pelo navegador';
  end if;
  if not has_table_privilege('service_role', 'migracao_kommo.livro_razao', 'INSERT') then
    raise exception '1014: service_role não consegue escrever no livro-razão';
  end if;

  -- A conferência de forma tem de recusar entrada malformada SEM escrever.
  -- Roda em banco vazio: não depende de conta nenhuma existir.
  begin
    perform public.cb_kommo_carregar_lote(
      '00000000-0000-0000-0000-000000000000'::uuid, '"nao é array"'::jsonb, true);
    raise exception '1014: a função aceitou p_grupos que não é array';
  exception
    when sqlstate 'P0001' then null;  -- recusou, que é o esperado
  end;

  -- O desfazer existe e está igualmente fechado.
  if to_regprocedure('public.cb_kommo_desfazer(uuid, bigint, boolean)') is null then
    raise exception '1014: o desfazer não foi criado — sem ele o piloto não pode rodar';
  end if;
  if has_function_privilege('anon', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1014: o desfazer está executável pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_kommo_desfazer(uuid, bigint, boolean)', 'EXECUTE') then
    raise exception '1014: service_role PERDEU o execute do desfazer';
  end if;

  -- O livro tem a chave complementar que o desfazer de etiqueta exige.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'migracao_kommo' and table_name = 'livro_razao'
                    and column_name = 'detalhe') then
    raise exception '1014: o livro-razão está sem `detalhe` — o desfazer não saberia qual etiqueta tirar';
  end if;

  raise notice '1014: função de lote, desfazer, livro-razão e privilégios conferidos.';
end
$conferir$;
