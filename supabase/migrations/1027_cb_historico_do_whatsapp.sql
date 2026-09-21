-- ============================================================
-- 1027 — O histórico de 2026 do WhatsApp, trazido para as fichas com card.
--
-- Pedido do operador (21/09/2026): os leads da Kommo já estão aqui, com card,
-- mas a conversa de 2026 ficou na Kommo — que só entrega metadado, nunca o
-- texto. O texto existe na Evolution: na conexão viva (o que o WhatsApp mandou
-- ao parear, jun–set) e no backup de 09/09 da conexão antiga "Bancario" (o
-- MESMO número do Bancário - Comercial, jan–ago). Medido: 71.306 mensagens
-- para 997 fichas com card; validado contra a Kommo em 7 clientes (799 × 790).
--
-- Quem lê a Evolution e monta cada linha é um script fora do repositório (o
-- conteúdo é de cliente); esta migration dá a ele UMA porta de escrita, por
-- lote, e o registro para desfazer. Mesmo desenho da carga da Kommo (1014).
--
-- ⚠️⚠️ O QUE A IMPORTAÇÃO NÃO FAZ — e por quê cada um está garantido AQUI:
--
--  • Não dispara automação, robô, IA nem roteador de funil: tudo isso mora no
--    CÓDIGO da ingestão (persistInboundMessage/persistDeviceMessage, webhook
--    da Meta). O INSERT direto não passa por ele. Nenhum gatilho de `messages`
--    enfileira evento (conferido no catálogo em 21/09: são três, listados
--    abaixo, e nenhum toca fila de automação).
--  • Não reabre conversa: reabrir é `reopenClosedConversation`, código.
--    Nenhum gatilho mexe em `conversations.status`.
--  • Não soma não lida: `unread_count` só muda pela RPC da ingestão.
--  • Não acende "em atraso": o gatilho da 972 decide pela ORDEM DE INSERÇÃO —
--    uma fala de cliente de junho inserida hoje preencheria
--    `aguardando_desde` (e o selo vermelho numa conversa aberta), e um eco
--    antigo do escritório APAGARIA uma espera verdadeira de hoje. Por isso os
--    gatilhos de `messages` são DESLIGADOS dentro do lote (DDL transacional,
--    como na 1014: um erro no meio religa sozinho) e religados no fim.
--  • Não mexe na janela de 24h da Meta: o gatilho da 993 também fica calado
--    (ele já não agiria — as linhas são da Evolution —, mas desligado não há o
--    que conferir).
--  • `gravada_em` vai NULA, como nas linhas anteriores à 1003 ("não medido"):
--    com o default `now()`, a segunda linha de defesa da retomada de automação
--    (`clienteRespondeuDesde`, `gravada_em` > criação da espera) leria a fala
--    de junho como "o cliente respondeu agora", e a medição de atraso de
--    entrega (`gravada_em − created_at`) acusaria meses de atraso.
--
-- ⚠️ O QUE ELA MEXE EM `conversations`, e só isso:
--  • cria a conversa ENCERRADA (dono durável, sem responsável, sem não lida)
--    da ficha que não tinha nenhuma — o precedente é a 1016;
--  • grava `last_message_at`/`last_message_text` SÓ em conversa ENCERRADA e
--    só quando o histórico é mais novo que o que ela mostra (ou ela não mostra
--    nada — as conversas que a carga criou para as anotações). Conversa ABERTA
--    nunca é tocada: nem prévia, nem ordem na lista. O valor de antes vai para
--    o registro, e o desfazer o devolve.
--
-- ⚠️ A trava: `ALTER TABLE … DISABLE TRIGGER` (os dois AFTER INSERT de
-- `messages`, pelo nome; e `set_updated_at` de `conversations` só na
-- instrução da prévia) pega ShareRowExclusiveLock até o fim do lote. Leitor não espera; a ingestão ao
-- vivo espera o lote terminar (lotes curtos: frações de segundo). `lock_timeout`
-- de 5 s: se a tabela estiver ocupada, o lote falha e o script tenta de novo.
--
-- ⚠️ Limite conhecido, não tratado: o gatilho de mensagem APAGADA da 972
-- recalcula a espera sobre TODAS as mensagens da conversa aberta — apagar uma
-- mensagem numa conversa cujo histórico termina em fala de cliente sem
-- resposta de gente pode acender o selo sobre essa fala antiga. É o defeito já
-- descrito no CLAUDE.md (seção da 1010) e alcança o histórico importado igual.
-- ============================================================

create schema if not exists migracao_kommo;
revoke all on schema migracao_kommo from public;
revoke all on schema migracao_kommo from anon, authenticated;
grant usage on schema migracao_kommo to service_role;

-- O registro. Separado do `livro_razao` da carga DE PROPÓSITO: o desfazer da
-- Kommo (1022) ABORTA em tabela que não conhece ("não sei desfazer … em
-- messages"), então uma linha daqui lá dentro travaria o desfazer da carga.
create table if not exists migracao_kommo.historico_whatsapp (
  id          bigserial primary key,
  account_id  uuid not null,
  lote        text not null,
  acao        text not null,
  tabela      text not null,
  registro_id uuid not null,
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now(),
  constraint historico_whatsapp_acao_ck check (acao in ('criou', 'alterou')),
  constraint historico_whatsapp_tabela_ck check (tabela in ('messages', 'conversations')),
  constraint historico_whatsapp_antes_ck check ((acao = 'alterou') = (antes is not null))
);
create index if not exists historico_whatsapp_conta_idx
  on migracao_kommo.historico_whatsapp (account_id, lote);
-- Uma linha por objeto e ação: a mensagem criada, a conversa criada, e o
-- "antes" da conversa alterada — gravado UMA vez, na primeira alteração (o
-- antes que importa é o de antes do backfill, não o do lote anterior).
create unique index if not exists historico_whatsapp_objeto_uidx
  on migracao_kommo.historico_whatsapp (tabela, acao, registro_id);

revoke all on table migracao_kommo.historico_whatsapp from public;
revoke all on table migracao_kommo.historico_whatsapp from anon, authenticated;
grant select, insert, update, delete on table migracao_kommo.historico_whatsapp to service_role;
grant usage, select on sequence migracao_kommo.historico_whatsapp_id_seq to service_role;

-- ------------------------------------------------------------
-- A porta de escrita, por lote.
--
-- p_mensagens: lista de objetos, uma mensagem cada, JÁ no formato da linha de
-- `messages` (quem normaliza é o script, com o código da ingestão):
--   contact_id, channel_id, message_id, remote_jid, remote_jid_lid, from_me,
--   from_device, sender_type, content_type, content_text, media_filename,
--   media_type, media_state, status, created_at, cita (id da mensagem citada,
--   opcional), previa (o texto que a lista mostraria, opcional).
-- p_conferir = true: valida e conta, sem escrever nada.
-- ------------------------------------------------------------
create or replace function public.cb_importar_historico_whatsapp(
  p_account_id uuid,
  p_lote       text,
  p_mensagens  jsonb,
  p_conferir   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dono        uuid;
  v_ruim        text;
  v_total       int;
  v_conv_novas  int := 0;
  v_inseridas   int := 0;
  v_citacoes    int := 0;
  v_alteradas   int := 0;
begin
  if p_lote is null or btrim(p_lote) = '' then
    raise exception 'cb_importar_historico_whatsapp: lote sem nome';
  end if;
  if p_mensagens is null or jsonb_typeof(p_mensagens) <> 'array' then
    raise exception 'cb_importar_historico_whatsapp: p_mensagens tem de ser uma lista';
  end if;
  select owner_user_id into v_dono from accounts where id = p_account_id;
  if v_dono is null then
    raise exception 'cb_importar_historico_whatsapp: conta % não existe', p_account_id;
  end if;

  drop table if exists _hist;
  create temp table _hist on commit drop as
  select distinct on (x.contact_id, x.message_id) x.*, null::uuid as conversation_id
    from jsonb_to_recordset(p_mensagens) as x(
      contact_id uuid, channel_id uuid, message_id text, remote_jid text,
      remote_jid_lid text, from_me boolean, from_device boolean,
      sender_type text, content_type text, content_text text,
      media_filename text, media_type text, media_state text, status text,
      created_at timestamptz, cita text, previa text)
   order by x.contact_id, x.message_id, x.created_at;
  get diagnostics v_total = row_count;

  -- ---------- validação: a primeira linha ruim para o lote, nomeada ----------
  select coalesce(message_id, '(sem id)') into v_ruim from _hist
   where message_id is null or btrim(message_id) = ''
      or created_at is null or created_at > now()
      -- `coalesce` em tudo: `null not in (…)` é NULL, e NULL no WHERE deixa passar
      or coalesce(sender_type, '') not in ('customer', 'agent')
      or (coalesce(from_device, false) and sender_type <> 'agent')
      or content_type is null
      or coalesce(status, '') not in ('sent', 'delivered', 'read')
      or (media_state is not null and media_state not in ('pending', 'failed', 'too_large'))
   limit 1;
  if v_ruim is not null then
    raise exception 'cb_importar_historico_whatsapp: mensagem % com campo obrigatório ausente ou inválido', v_ruim;
  end if;
  select h.message_id into v_ruim from _hist h
   where not exists (select 1 from contacts c where c.id = h.contact_id and c.account_id = p_account_id)
   limit 1;
  if v_ruim is not null then
    raise exception 'cb_importar_historico_whatsapp: mensagem % aponta para ficha que não é desta conta', v_ruim;
  end if;
  select h.message_id into v_ruim from _hist h
   where h.channel_id is not null
     and not exists (select 1 from cb_channels ch where ch.id = h.channel_id and ch.account_id = p_account_id)
   limit 1;
  if v_ruim is not null then
    raise exception 'cb_importar_historico_whatsapp: mensagem % aponta para conexão que não é desta conta', v_ruim;
  end if;

  update _hist h set conversation_id = v.id
    from conversations v
   where v.account_id = p_account_id and v.contact_id = h.contact_id;

  if p_conferir then
    return jsonb_build_object(
      'mensagens', v_total,
      'conversas_a_criar', (select count(distinct contact_id) from _hist where conversation_id is null),
      'ja_existem', (select count(*) from _hist h join messages m
                      on m.conversation_id = h.conversation_id and m.message_id = h.message_id),
      'escreveu', false);
  end if;

  set local lock_timeout = '5s';

  -- ---------- conversas novas, já ENCERRADAS ----------
  with ultima as (
    select distinct on (contact_id) contact_id, channel_id, created_at, previa
      from _hist where conversation_id is null
     order by contact_id, created_at desc
  ), criadas as (
    insert into conversations (account_id, user_id, contact_id, status, channel_id,
                               last_message_at, last_message_text)
    select p_account_id, v_dono, u.contact_id, 'closed', u.channel_id, u.created_at, u.previa
      from ultima u
    on conflict (account_id, contact_id) do nothing
    returning id, contact_id
  ), registro as (
    insert into migracao_kommo.historico_whatsapp (account_id, lote, acao, tabela, registro_id)
    select p_account_id, p_lote, 'criou', 'conversations', c.id from criadas c
    returning 1
  )
  select count(*) into v_conv_novas from registro;

  update _hist h set conversation_id = v.id
    from conversations v
   where h.conversation_id is null
     and v.account_id = p_account_id and v.contact_id = h.contact_id;

  -- ---------- as mensagens, com os gatilhos de `messages` calados ----------
  alter table public.messages disable trigger cb_marcar_aguardando_resposta_trigger;
  alter table public.messages disable trigger cb_marcar_janela_da_meta_trigger;

  with novas as (
    insert into messages (conversation_id, sender_type, sender_id, content_type,
                          content_text, message_id, status, created_at, remote_jid,
                          remote_jid_lid, from_me, from_device, channel_id,
                          media_state, media_type, media_filename, gravada_em)
    select h.conversation_id, h.sender_type, null, h.content_type,
           h.content_text, h.message_id, h.status, h.created_at, h.remote_jid,
           h.remote_jid_lid, coalesce(h.from_me, h.sender_type = 'agent'),
           coalesce(h.from_device, false), h.channel_id,
           h.media_state, h.media_type, h.media_filename, null
      from _hist h
     order by h.created_at
    on conflict (conversation_id, message_id) do nothing
    returning id
  ), registro as (
    insert into migracao_kommo.historico_whatsapp (account_id, lote, acao, tabela, registro_id)
    select p_account_id, p_lote, 'criou', 'messages', n.id from novas n
    returning 1
  )
  select count(*) into v_inseridas from registro;

  -- A citação: só depois de inseridas (a citada pode ter vindo neste lote ou
  -- num anterior — o script manda em ordem cronológica). Só nas que ESTE
  -- backfill criou, e só se ainda não têm citação.
  update messages m set reply_to_message_id = q.id
    from _hist h
    join messages q on q.conversation_id = h.conversation_id and q.message_id = h.cita
   where h.cita is not null
     and m.conversation_id = h.conversation_id and m.message_id = h.message_id
     and m.reply_to_message_id is null
     and exists (select 1 from migracao_kommo.historico_whatsapp r
                  where r.tabela = 'messages' and r.acao = 'criou' and r.registro_id = m.id);
  get diagnostics v_citacoes = row_count;

  alter table public.messages enable trigger cb_marcar_aguardando_resposta_trigger;
  alter table public.messages enable trigger cb_marcar_janela_da_meta_trigger;

  -- ---------- a prévia da conversa ENCERRADA, só quando o histórico é mais novo ----------
  -- O "antes" entra no registro UMA vez (a primeira alteração); o "depois" é
  -- reescrito a cada lote, para o desfazer saber se alguém mexeu depois.
  -- Em instruções SEPARADAS, de propósito: as partes de um WITH compartilham a
  -- mesma foto, e o UPDATE do "depois" não enxergaria a linha que o INSERT do
  -- "antes" acabou de criar — o desfazer nunca devolveria a prévia.
  -- TRAVA antes de decidir: sem isso, uma mensagem do cliente chegando agora
  -- reabre a conversa e a ingestão grava `last_message_at = agora`; o UPDATE
  -- abaixo, decidido sobre a foto velha, a devolveria à hora do histórico e a
  -- conversa ABERTA desceria na lista. Travada, a decisão é tomada sobre o
  -- valor vigente, e o UPDATE ainda repete a condição (EvalPlanQual).
  perform 1 from conversations v
   where v.id in (select distinct conversation_id from _hist)
   order by v.id
   for update of v;

  drop table if exists _alvo;
  create temp table _alvo on commit drop as
  select v.id, v.last_message_at, v.last_message_text, u.created_at as nova_em,
         coalesce(u.previa, v.last_message_text) as nova_previa
    from (select distinct on (conversation_id) conversation_id, created_at, previa
            from _hist order by conversation_id, created_at desc) u
    join conversations v on v.id = u.conversation_id
   where v.status = 'closed'
     and (v.last_message_at is null or v.last_message_at < u.created_at);

  insert into migracao_kommo.historico_whatsapp (account_id, lote, acao, tabela, registro_id, antes)
  select p_account_id, p_lote, 'alterou', 'conversations', a.id,
         jsonb_build_object('last_message_at', a.last_message_at, 'last_message_text', a.last_message_text)
    from _alvo a
   where not exists (select 1 from migracao_kommo.historico_whatsapp r
                      where r.tabela = 'conversations' and r.registro_id = a.id)
  on conflict (tabela, acao, registro_id) do nothing;

  -- `set_updated_at` calado SÓ nesta instrução: ele é BEFORE UPDATE sem lista
  -- de colunas e empurraria `updated_at` para agora — e o desfazer do
  -- encerramento em lote (1020) só devolve a conversa com
  -- `updated_at <= encerrado_em`. A prévia de uma conversa encerrada não é
  -- "alguém mexeu nela". Pelo nome, nunca USER: os outros dois gatilhos de
  -- `conversations` (0027 e 0972) não disparam neste UPDATE de qualquer jeito.
  alter table public.conversations disable trigger set_updated_at;
  update conversations v
     set last_message_at = a.nova_em, last_message_text = a.nova_previa
    from _alvo a
   where v.id = a.id
     and v.status = 'closed'
     and (v.last_message_at is null or v.last_message_at < a.nova_em);
  get diagnostics v_alteradas = row_count;
  alter table public.conversations enable trigger set_updated_at;

  -- o "depois" de TODA linha da conversa (a 'alterou' e a 'criou' deste
  -- backfill): é contra ele que o desfazer decide se alguém mexeu depois
  update migracao_kommo.historico_whatsapp r
     set depois = jsonb_build_object('last_message_at', a.nova_em, 'last_message_text', a.nova_previa)
    from _alvo a
   where r.tabela = 'conversations' and r.registro_id = a.id;

  return jsonb_build_object(
    'mensagens', v_total,
    'inseridas', v_inseridas,
    'repetidas', v_total - v_inseridas,
    'conversas_criadas', v_conv_novas,
    'conversas_com_previa_nova', v_alteradas,
    'citacoes', v_citacoes,
    'escreveu', true);
end;
$$;

-- ------------------------------------------------------------
-- O desfazer. p_conferir = true (o PADRÃO) só conta.
-- Sai: toda mensagem que o backfill criou; a conversa que ele criou e que
-- continua sem mensagem nenhuma e encerrada (se o cliente escreveu depois,
-- ela FICA, com a linha no registro — desfazer repetível, como o da 1022);
-- a prévia que ele trocou, se ninguém a mudou depois (compara com o `depois`).
-- ------------------------------------------------------------
create or replace function public.cb_desfazer_historico_whatsapp(
  p_account_id uuid,
  p_lote       text default null,
  p_conferir   boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msgs    int := 0;
  v_convs   int := 0;
  v_previas int := 0;
  v_retidas int := 0;
begin
  if p_conferir then
    return jsonb_build_object(
      'mensagens', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'messages'
                       and (p_lote is null or lote = p_lote)),
      'conversas_criadas', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'conversations' and acao = 'criou'
                       and (p_lote is null or lote = p_lote)),
      'previas', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'conversations' and acao = 'alterou'
                       and (p_lote is null or lote = p_lote)),
      'desfez', false);
  end if;

  set local lock_timeout = '5s';
  alter table public.messages disable trigger cb_marcar_aguardando_resposta_trigger;
  alter table public.messages disable trigger cb_marcar_janela_da_meta_trigger;

  delete from messages m
   using migracao_kommo.historico_whatsapp r
   where r.account_id = p_account_id and r.tabela = 'messages' and r.acao = 'criou'
     and (p_lote is null or r.lote = p_lote)
     and m.id = r.registro_id;
  get diagnostics v_msgs = row_count;
  delete from migracao_kommo.historico_whatsapp r
   where r.account_id = p_account_id and r.tabela = 'messages' and r.acao = 'criou'
     and (p_lote is null or r.lote = p_lote);

  alter table public.messages enable trigger cb_marcar_aguardando_resposta_trigger;
  alter table public.messages enable trigger cb_marcar_janela_da_meta_trigger;

  -- a prévia volta ao que era, se ainda é a que o backfill gravou — também sem
  -- empurrar `updated_at` (mesmo motivo da importação)
  alter table public.conversations disable trigger set_updated_at;
  with voltou as (
    update conversations v
       set last_message_at = (r.antes->>'last_message_at')::timestamptz,
           last_message_text = r.antes->>'last_message_text'
      from migracao_kommo.historico_whatsapp r
     where r.account_id = p_account_id and r.tabela = 'conversations' and r.acao = 'alterou'
       and (p_lote is null or r.lote = p_lote)
       and v.id = r.registro_id
       and v.last_message_at is not distinct from (r.depois->>'last_message_at')::timestamptz
    returning r.id
  ), limpo as (
    delete from migracao_kommo.historico_whatsapp r using voltou w where r.id = w.id returning 1
  )
  select count(*) into v_previas from limpo;
  alter table public.conversations enable trigger set_updated_at;

  with apagadas as (
    delete from conversations v
     using migracao_kommo.historico_whatsapp r
     where r.account_id = p_account_id and r.tabela = 'conversations' and r.acao = 'criou'
       and (p_lote is null or r.lote = p_lote)
       and v.id = r.registro_id and v.status = 'closed'
       and not exists (select 1 from messages m where m.conversation_id = v.id)
       and not exists (select 1 from cb_conversation_notes n where n.conversation_id = v.id)
    returning r.id
  ), limpo as (
    delete from migracao_kommo.historico_whatsapp r using apagadas a where r.id = a.id returning 1
  )
  select count(*) into v_convs from limpo;

  select count(*) into v_retidas from migracao_kommo.historico_whatsapp
   where account_id = p_account_id and tabela = 'conversations'
     and (p_lote is null or lote = p_lote);

  return jsonb_build_object('mensagens', v_msgs, 'conversas', v_convs,
                            'previas', v_previas, 'retidas', v_retidas, 'desfez', true);
end;
$$;

revoke execute on function public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)
  to service_role;
revoke execute on function public.cb_desfazer_historico_whatsapp(uuid, text, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_desfazer_historico_whatsapp(uuid, text, boolean)
  to service_role;

-- ------------------------------------------------------------
-- Conferência. A função é CHAMADA (regra 3 do CLAUDE.md) num subbloco que se
-- desfaz pela exceção própria P1027 — nada sobra no banco. Banco vazio pula.
-- ------------------------------------------------------------
do $$
declare
  v_conta   uuid;
  v_contato uuid;
  v_conv    uuid;
  v_antes   record;
  v_depois  record;
  v_r       jsonb;
  v_r2      jsonb;
  v_ligados int;
begin
  if to_regclass('migracao_kommo.historico_whatsapp') is null then
    raise exception '1027: o registro não foi criado';
  end if;
  if has_function_privilege('anon', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cb_desfazer_historico_whatsapp(uuid, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_desfazer_historico_whatsapp(uuid, text, boolean)', 'EXECUTE') then
    raise exception '1027: as funções continuam executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE') then
    raise exception '1027: o service_role perdeu o EXECUTE da importação';
  end if;
  if has_table_privilege('anon', 'migracao_kommo.historico_whatsapp', 'SELECT')
     or has_table_privilege('authenticated', 'migracao_kommo.historico_whatsapp', 'SELECT') then
    raise exception '1027: o registro está legível pelo navegador';
  end if;

  -- uma conversa ENCERRADA existente, para provar que nada nela muda além do fio
  select v.account_id, v.contact_id, v.id into v_conta, v_contato, v_conv
    from conversations v
   where v.contact_id is not null and v.status = 'closed'
   limit 1;
  if v_conv is null then
    raise notice '1027: banco sem conversa encerrada de contato — a chamada não foi provada aqui.';
    return;
  end if;

  begin
    select status, unread_count, aguardando_desde, assigned_agent_id, last_message_at
      into v_antes from conversations where id = v_conv;

    v_r := public.cb_importar_historico_whatsapp(v_conta, 'conferencia-1027', jsonb_build_array(
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1027-a',
        'sender_type', 'customer', 'from_me', false, 'from_device', false,
        'content_type', 'text', 'content_text', 'conferência', 'status', 'delivered',
        'created_at', '2026-01-02T12:00:00Z', 'previa', 'conferência'),
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1027-b',
        'sender_type', 'agent', 'from_me', true, 'from_device', true,
        'content_type', 'text', 'content_text', 'resposta', 'status', 'read',
        'created_at', '2026-01-02T12:01:00Z', 'cita', 'conferencia-1027-a')));
    if (v_r->>'inseridas')::int <> 2 or (v_r->>'citacoes')::int <> 1 then
      raise exception '1027: a importação devolveu %', v_r;
    end if;

    select status, unread_count, aguardando_desde, assigned_agent_id, last_message_at
      into v_depois from conversations where id = v_conv;
    if v_depois.status <> v_antes.status
       or v_depois.unread_count is distinct from v_antes.unread_count
       or v_depois.aguardando_desde is distinct from v_antes.aguardando_desde
       or v_depois.assigned_agent_id is distinct from v_antes.assigned_agent_id then
      raise exception '1027: a importação mexeu na conversa (situação, não lidas, espera ou responsável)';
    end if;
    if exists (select 1 from messages where conversation_id = v_conv
                and message_id like 'conferencia-1027-%' and gravada_em is not null) then
      raise exception '1027: a mensagem importada nasceu com gravada_em';
    end if;

    select count(*) into v_ligados from pg_trigger
     where tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
       and not tgisinternal and tgenabled = 'D';
    if v_ligados > 0 then
      raise exception '1027: % gatilho(s) de messages/conversations ficaram desligados', v_ligados;
    end if;

    v_r2 := public.cb_importar_historico_whatsapp(v_conta, 'conferencia-1027', jsonb_build_array(
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1027-a',
        'sender_type', 'customer', 'content_type', 'text', 'content_text', 'conferência',
        'status', 'delivered', 'created_at', '2026-01-02T12:00:00Z')));
    if (v_r2->>'inseridas')::int <> 0 then
      raise exception '1027: a reimportação duplicou (%)', v_r2;
    end if;

    v_r2 := public.cb_desfazer_historico_whatsapp(v_conta, 'conferencia-1027', false);
    if (v_r2->>'mensagens')::int <> 2
       or exists (select 1 from messages where conversation_id = v_conv and message_id like 'conferencia-1027-%') then
      raise exception '1027: o desfazer não tirou as mensagens (%)', v_r2;
    end if;
    if (select last_message_at from conversations where id = v_conv) is distinct from v_antes.last_message_at then
      raise exception '1027: o desfazer não devolveu a prévia';
    end if;

    raise exception using errcode = 'P1027', message = 'conferência desfeita';
  exception when sqlstate 'P1027' then
    null;
  end;
  raise notice '1027: importação, reimportação e desfazer conferidos numa conversa encerrada (desfeito).';
end $$;
