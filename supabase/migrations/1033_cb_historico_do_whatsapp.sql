-- ============================================================
-- 1033 — O histórico de 2026 do WhatsApp, trazido para as fichas com card.
--
-- ⚠️ APLICADA EM PRODUÇÃO COMO 1027 (histórico `20260921201327`, 21/09/2026).
-- O arquivo virou 1033 no merge porque, quando ele chegou ao `main`, já
-- estavam lá a 1030, a 1031 e a 1032 — e a instalação que atualiza por
-- `supabase db push` RECUSA migration com número menor que o maior já
-- aplicado (a regra do CLAUDE.md; a do "perdido que volta" nasceu 1028 e virou
-- 1031 pelo mesmo motivo). A ordem não muda nada no resultado: esta migration
-- cria um registro em `migracao_kommo`, três funções e as concessões delas —
-- nenhuma policy, nada que a 1030 (função de disparo), a 1031 (resultado da
-- etapa) ou a 1032 (policies de leitura do `public`) toquem ou leiam.
--
-- Pedido do operador (21/09/2026): os leads da Kommo já estão aqui, com card,
-- mas a conversa de 2026 ficou na Kommo — que só entrega metadado, nunca o
-- texto. O texto existe na Evolution: na conexão viva (o que o WhatsApp mandou
-- ao parear, jun–set) e no backup de 09/09 da conexão antiga "Bancario" (o
-- MESMO número do Bancário - Comercial, jan–ago). Validado contra a Kommo em 7
-- clientes (799 × 790).
--
-- Quem lê a Evolution e monta cada linha é um script fora do repositório (o
-- conteúdo é de cliente), com o `normalizeUpsert` da própria ingestão; esta
-- migration dá a ele UMA porta de escrita, por lote, e o registro para
-- desfazer. Mesmo desenho da carga da Kommo (1014).
--
-- ⚠️⚠️ O QUE A IMPORTAÇÃO NÃO FAZ — e onde isso está garantido:
--
--  • Não dispara automação, robô, IA nem roteador de funil: tudo isso mora no
--    CÓDIGO da ingestão. O INSERT direto não passa por ele, e nenhum gatilho
--    de `messages` toca fila de automação (catálogo conferido em 21/09).
--  • Não reabre conversa, não soma não lida: os dois só mudam por código.
--  • Não acende "em atraso": o gatilho da 0972 decide pela ORDEM DE INSERÇÃO —
--    a fala de junho inserida hoje preencheria `aguardando_desde` (que
--    sobrevive à reabertura), e um eco antigo do escritório apagaria uma
--    espera verdadeira. Os dois gatilhos AFTER INSERT de `messages` ficam
--    calados DENTRO do lote, pelo nome (DDL transacional: erro no meio religa).
--  • `gravada_em` vai NULA ("não medido", como antes da 1003): com o default,
--    `clienteRespondeuDesde` leria a fala antiga como "respondeu agora".
--  • Mensagem apagada para todos entra APAGADA (`deleted_at`/`deleted_by`) e a
--    editada entra marcada (`edited_at`) — a ingestão guardaria as duas assim.
--
-- ⚠️ O QUE ELA MEXE EM `conversations`, e só isso:
--  • cria a conversa ENCERRADA da ficha que não tinha nenhuma (dono durável,
--    sem responsável, sem não lida) — o precedente é a 1016;
--  • grava a prévia (`last_message_at`/`last_message_text`) SÓ em conversa
--    ENCERRADA e só quando o histórico é mais novo que o que ela mostra, com
--    `set_updated_at` calado: o desfazer do encerramento em lote (1020) só
--    devolve conversa com `updated_at <= encerrado_em`. Conversa ABERTA nunca
--    é tocada.
--
-- ⚠️⚠️ AS TRAVAS — a ordem é a do gatilho da 0972 (messages → conversations).
-- Pegas NO COMEÇO, antes de qualquer escrita (revisão adversarial de 21/09):
-- a primeira versão travava LINHAS de conversations e só depois pedia a trava
-- de TABELA, e a ingestão viva que chegasse no meio fechava um ciclo com o
-- lote — o detector abortava a INGESTÃO (a mensagem do cliente sumia, com a
-- Evolution já respondida) ou a reabertura (a mensagem ficava numa conversa
-- encerrada). Com as duas tabelas travadas antes, a ingestão espera o lote
-- terminar sem segurar nada que ele precise. `lock_timeout` de 1 s: tabela
-- ocupada, o lote falha e o script tenta de novo — a espera total com
-- `messages` travada fica limitada a ~1 s por tentativa. E um advisory lock
-- serializa importação e desfazer entre si.
--
-- ⚠️ Limites conhecidos, não tratados aqui (escritos no plano):
--  • o gatilho de mensagem APAGADA da 0972 recalcula a espera sobre TODAS as
--    mensagens da conversa aberta, as importadas incluídas (defeito já
--    descrito na seção da 1010 do CLAUDE.md);
--  • o tempo real do lote chega a toda aba de inbox aberta (prévia antiga e
--    não lida só NA TELA, até recarregar) — a carga grande roda fora do
--    expediente;
--  • o desfazer do encerramento em lote (1020) de uma conversa cuja prévia o
--    backfill trocou devolve a espera da foto — desfazer o backfill antes.
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
  on migracao_kommo.historico_whatsapp (account_id, lote, tabela);
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
-- A conversa é APONTADA por alguma coisa além das mensagens? Devolve o nome da
-- primeira tabela que aponta (ou NULL). Lê o CATÁLOGO, e não uma lista escrita
-- à mão: são 12 tabelas hoje (agendada, favorito, presença, anotação, Radar,
-- reunião, card, robô, reação, aviso, uso de IA…), e quem criar a 13ª não vai
-- lembrar de vir aqui. É o que impede o desfazer de apagar a conversa criada
-- pelo backfill levando junto, pelo CASCADE, uma agendada pendente.
-- ------------------------------------------------------------
create or replace function public.cb_historico_conversa_apontada(p_conversa uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fk record;
  v_achou boolean;
begin
  for v_fk in
    select c.conrelid::regclass as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.confrelid = 'public.conversations'::regclass
       and c.contype = 'f'
       and c.conrelid <> 'public.messages'::regclass
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tabela, v_fk.coluna)
      into v_achou using p_conversa;
    if v_achou then
      return v_fk.tabela::text;
    end if;
  end loop;
  return null;
end;
$$;

-- ------------------------------------------------------------
-- A porta de escrita, por lote.
--
-- p_mensagens: lista de objetos, uma mensagem cada, JÁ no formato da linha de
-- `messages` (quem normaliza é o script, com o código da ingestão):
--   contact_id, channel_id, message_id, remote_jid, remote_jid_lid, from_me,
--   from_device, sender_type, content_type, content_text, media_filename,
--   media_type, media_state, status, created_at, deleted_at, deleted_by,
--   edited_at, cita (id da mensagem citada), previa (o texto da lista; nulo
--   na mensagem apagada).
-- p_conferir = true: valida e conta, sem escrever nada e sem travar nada.
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
      created_at timestamptz, deleted_at timestamptz, deleted_by text,
      edited_at timestamptz, cita text, previa text)
   order by x.contact_id, x.message_id, x.created_at;
  get diagnostics v_total = row_count;

  -- ---------- validação: a primeira linha ruim para o lote, nomeada ----------
  -- `coalesce` em tudo: `null not in (…)` é NULL, e NULL no WHERE deixa passar
  select coalesce(message_id, '(sem id)') into v_ruim from _hist
   where message_id is null or btrim(message_id) = ''
      or created_at is null or created_at > now()
      or coalesce(sender_type, '') not in ('customer', 'agent')
      or (coalesce(from_device, false) and sender_type <> 'agent')
      or content_type is null
      or coalesce(status, '') not in ('sent', 'delivered', 'read')
      or (media_state is not null and media_state not in ('pending', 'failed', 'too_large'))
      or ((deleted_at is null) <> (deleted_by is null))
      or (deleted_by is not null and deleted_by not in ('customer', 'agent'))
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

  -- ---------- as travas, NESTA ordem, antes de qualquer escrita ----------
  set local lock_timeout = '1s';
  perform pg_advisory_xact_lock(hashtext('cb_historico_whatsapp'));
  lock table public.messages in share row exclusive mode;
  lock table public.conversations in share row exclusive mode;

  -- quem escreveu entre a leitura acima e a trava: a foto de agora manda
  update _hist h set conversation_id = v.id
    from conversations v
   where h.conversation_id is null
     and v.account_id = p_account_id and v.contact_id = h.contact_id;

  -- ---------- conversas novas, já ENCERRADAS ----------
  -- prévia e canal da mensagem mais recente que NÃO foi apagada
  with ultima as (
    select distinct on (contact_id) contact_id, channel_id, created_at, previa
      from _hist where conversation_id is null and deleted_at is null
     order by contact_id, created_at desc
  ), todas as (
    select distinct contact_id from _hist where conversation_id is null
  ), criadas as (
    insert into conversations (account_id, user_id, contact_id, status, channel_id,
                               last_message_at, last_message_text)
    select p_account_id, v_dono, t.contact_id, 'closed', u.channel_id, u.created_at, u.previa
      from todas t left join ultima u on u.contact_id = t.contact_id
    on conflict (account_id, contact_id) do nothing
    returning id, last_message_at, last_message_text
  ), registro as (
    -- o "depois" sai do RETURNING: as partes de um WITH compartilham a foto, e
    -- um SELECT em conversations aqui não enxergaria a linha recém-criada
    insert into migracao_kommo.historico_whatsapp (account_id, lote, acao, tabela, registro_id, depois)
    select p_account_id, p_lote, 'criou', 'conversations', c.id,
           jsonb_build_object('last_message_at', c.last_message_at, 'last_message_text', c.last_message_text)
      from criadas c
    returning 1
  )
  select count(*) into v_conv_novas from registro;

  update _hist h set conversation_id = v.id
    from conversations v
   where h.conversation_id is null
     and v.account_id = p_account_id and v.contact_id = h.contact_id;

  -- ---------- as mensagens, com os dois gatilhos de INSERT calados ----------
  alter table public.messages disable trigger cb_marcar_aguardando_resposta_trigger;
  alter table public.messages disable trigger cb_marcar_janela_da_meta_trigger;

  with novas as (
    insert into messages (conversation_id, sender_type, sender_id, content_type,
                          content_text, message_id, status, created_at, remote_jid,
                          remote_jid_lid, from_me, from_device, channel_id,
                          media_state, media_type, media_filename,
                          deleted_at, deleted_by, edited_at, gravada_em)
    select h.conversation_id, h.sender_type, null, h.content_type,
           h.content_text, h.message_id, h.status, h.created_at, h.remote_jid,
           h.remote_jid_lid, coalesce(h.from_me, h.sender_type = 'agent'),
           coalesce(h.from_device, false), h.channel_id,
           h.media_state, h.media_type, h.media_filename,
           h.deleted_at, h.deleted_by, h.edited_at, null
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
  -- num anterior — o script manda cada ficha inteira, em ordem cronológica).
  -- Só nas que ESTE backfill criou, e só se ainda não têm citação.
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
  -- Em instruções SEPARADAS, de propósito: as partes de um WITH compartilham a
  -- mesma foto, e o UPDATE do "depois" não enxergaria a linha que o INSERT do
  -- "antes" acabou de criar — o desfazer nunca devolveria a prévia.
  drop table if exists _alvo;
  create temp table _alvo on commit drop as
  select v.id, v.last_message_at, v.last_message_text, u.created_at as nova_em,
         coalesce(u.previa, v.last_message_text) as nova_previa, u.channel_id as novo_canal
    from (select distinct on (conversation_id) conversation_id, created_at, previa, channel_id
            from _hist where deleted_at is null
           order by conversation_id, created_at desc) u
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
  -- `updated_at <= encerrado_em`. Pelo nome, nunca USER. A conversa que ESTE
  -- backfill criou acompanha também o canal da mensagem mais nova.
  alter table public.conversations disable trigger set_updated_at;
  update conversations v
     set last_message_at = a.nova_em,
         last_message_text = a.nova_previa,
         channel_id = case when exists (select 1 from migracao_kommo.historico_whatsapp r
                                         where r.tabela = 'conversations' and r.acao = 'criou'
                                           and r.registro_id = v.id)
                           then coalesce(a.novo_canal, v.channel_id) else v.channel_id end
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
-- O desfazer, EM PEDAÇOS. p_conferir = true (o PADRÃO) só conta.
-- Cada chamada apaga até p_limite mensagens do lote e devolve `restam`; quando
-- não resta mais nenhuma, trata as conversas. Repetir até `restam = 0`.
--
-- Não sai (fica no registro, e a próxima chamada tenta de novo):
--  • a mensagem importada que uma mensagem de FORA do backfill cita — o
--    `ON DELETE SET NULL` tiraria a citação de uma resposta real;
--  • a conversa criada que alguém TOCOU: mensagem de verdade, qualquer tabela
--    apontando para ela (agendada, favorito, anotação, reunião, card…), ou
--    `updated_at` depois da criação (atribuir, fixar canal, reabrir). Ela
--    fica, com a prévia do backfill zerada se ainda for a dele.
-- Sem ALTER TABLE em `messages`: o DELETE não tem gatilho, e a exclusão mútua
-- com a importação é o advisory lock.
-- ------------------------------------------------------------
create or replace function public.cb_desfazer_historico_whatsapp(
  p_account_id uuid,
  p_lote       text default null,
  p_conferir   boolean default true,
  p_limite     int default 2000
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msgs     int := 0;
  v_restam   int := 0;
  v_citadas  int := 0;
  v_convs    int := 0;
  v_previas  int := 0;
  v_linha    record;
  v_apontada text;
  v_retidas  jsonb := '[]'::jsonb;
  v_orfas    int := 0;
  v_n        int := 0;
begin
  if p_conferir then
    return jsonb_build_object(
      'mensagens', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'messages'
                       and (p_lote is null or lote = p_lote)),
      'mensagens_citadas_de_fora', (select count(*) from migracao_kommo.historico_whatsapp r
                     join messages x on x.reply_to_message_id = r.registro_id
                    where r.account_id = p_account_id and r.tabela = 'messages'
                      and (p_lote is null or r.lote = p_lote)
                      and not exists (select 1 from migracao_kommo.historico_whatsapp r2
                                       where r2.tabela = 'messages' and r2.registro_id = x.id)),
      'conversas_criadas', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'conversations' and acao = 'criou'
                       and (p_lote is null or lote = p_lote)),
      'previas', (select count(*) from migracao_kommo.historico_whatsapp
                     where account_id = p_account_id and tabela = 'conversations' and acao = 'alterou'
                       and (p_lote is null or lote = p_lote)),
      'desfez', false);
  end if;
  if p_limite is null or p_limite < 1 then
    raise exception 'cb_desfazer_historico_whatsapp: p_limite tem de ser positivo';
  end if;

  set local lock_timeout = '1s';
  perform pg_advisory_xact_lock(hashtext('cb_historico_whatsapp'));

  -- linha de registro cujo objeto já não existe (ficha apagada pelo admin, com
  -- cascata): sai, senão contaria como "retida" para sempre
  delete from migracao_kommo.historico_whatsapp r
   where r.account_id = p_account_id and (p_lote is null or r.lote = p_lote)
     and ((r.tabela = 'messages' and not exists (select 1 from messages m where m.id = r.registro_id))
       or (r.tabela = 'conversations' and not exists (select 1 from conversations v where v.id = r.registro_id)));
  get diagnostics v_orfas = row_count;

  -- ---------- as mensagens, um pedaço ----------
  with alvo as (
    select r.id as linha, r.registro_id
      from migracao_kommo.historico_whatsapp r
     where r.account_id = p_account_id and r.tabela = 'messages' and r.acao = 'criou'
       and (p_lote is null or r.lote = p_lote)
       and not exists (select 1 from messages x
                        where x.reply_to_message_id = r.registro_id
                          and not exists (select 1 from migracao_kommo.historico_whatsapp r2
                                           where r2.tabela = 'messages' and r2.registro_id = x.id))
     order by r.id
     limit p_limite
  ), apagadas as (
    delete from messages m using alvo a where m.id = a.registro_id returning m.id
  ), limpo as (
    delete from migracao_kommo.historico_whatsapp r
     using alvo a where r.id = a.linha and a.registro_id in (select id from apagadas)
    returning 1
  )
  select count(*) into v_msgs from limpo;

  select count(*) into v_restam from migracao_kommo.historico_whatsapp r
   where r.account_id = p_account_id and r.tabela = 'messages'
     and (p_lote is null or r.lote = p_lote)
     and not exists (select 1 from messages x
                      where x.reply_to_message_id = r.registro_id
                        and not exists (select 1 from migracao_kommo.historico_whatsapp r2
                                         where r2.tabela = 'messages' and r2.registro_id = x.id));
  select count(*) into v_citadas from migracao_kommo.historico_whatsapp r
   where r.account_id = p_account_id and r.tabela = 'messages'
     and (p_lote is null or r.lote = p_lote);
  v_citadas := v_citadas - v_restam;

  if v_restam > 0 then
    return jsonb_build_object('mensagens', v_msgs, 'restam', v_restam, 'orfas_limpas', v_orfas,
                              'desfez', true, 'terminou', false);
  end if;

  -- ---------- as conversas, só quando as mensagens do lote acabaram ----------
  lock table public.conversations in share row exclusive mode;
  alter table public.conversations disable trigger set_updated_at;

  -- a prévia que o backfill trocou: se ainda sobra mensagem do backfill (de
  -- outro lote, ou citada) nela, a prévia é recalculada da mensagem mais nova
  -- que sobrou; senão volta ao "antes". Só se ninguém a mudou depois.
  for v_linha in
    select r.id, r.registro_id, r.antes, r.depois
      from migracao_kommo.historico_whatsapp r
     where r.account_id = p_account_id and r.tabela = 'conversations' and r.acao = 'alterou'
       and (p_lote is null or r.lote = p_lote)
  loop
    update conversations v
       set (last_message_at, last_message_text) = (
             select coalesce(u.created_at, (v_linha.antes->>'last_message_at')::timestamptz),
                    case when u.created_at is null then v_linha.antes->>'last_message_text'
                         else coalesce(nullif(u.content_text, ''), '[' || u.content_type || ']') end
               from (select 1) um
               left join lateral (
                 select m.created_at, m.content_text, m.content_type
                   from messages m
                  where m.conversation_id = v.id and m.deleted_at is null
                    and exists (select 1 from migracao_kommo.historico_whatsapp r3
                                 where r3.tabela = 'messages' and r3.registro_id = m.id)
                    and m.created_at > coalesce((v_linha.antes->>'last_message_at')::timestamptz, '-infinity')
                  order by m.created_at desc limit 1) u on true)
     where v.id = v_linha.registro_id
       and v.last_message_at is not distinct from (v_linha.depois->>'last_message_at')::timestamptz;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_previas := v_previas + 1;
      delete from migracao_kommo.historico_whatsapp where id = v_linha.id;
    else
      v_retidas := v_retidas || jsonb_build_object('conversa', v_linha.registro_id, 'motivo', 'previa_mudou_depois');
      delete from migracao_kommo.historico_whatsapp where id = v_linha.id;
    end if;
  end loop;

  -- a conversa que o backfill CRIOU: sai só se ninguém a tocou
  for v_linha in
    select r.id, r.registro_id, r.criado_em, r.depois
      from migracao_kommo.historico_whatsapp r
     where r.account_id = p_account_id and r.tabela = 'conversations' and r.acao = 'criou'
       and (p_lote is null or r.lote = p_lote)
  loop
    perform 1 from conversations v where v.id = v_linha.registro_id for update;
    v_apontada := null;
    if exists (select 1 from messages m where m.conversation_id = v_linha.registro_id) then
      v_apontada := 'messages';
    elsif exists (select 1 from conversations v where v.id = v_linha.registro_id
                   and (v.status <> 'closed' or v.updated_at > v_linha.criado_em
                        or v.assigned_agent_id is not null)) then
      v_apontada := 'conversa_mexida_depois';
    else
      v_apontada := public.cb_historico_conversa_apontada(v_linha.registro_id);
    end if;

    if v_apontada is null then
      delete from conversations where id = v_linha.registro_id;
      delete from migracao_kommo.historico_whatsapp where id = v_linha.id;
      v_convs := v_convs + 1;
    else
      -- fica; e se a prévia ainda é a do backfill e não sobrou mensagem do
      -- backfill, a prévia some (senão a lista mostraria uma fala que não existe)
      update conversations v
         set last_message_at = null, last_message_text = null
       where v.id = v_linha.registro_id
         and v.last_message_at is not distinct from (v_linha.depois->>'last_message_at')::timestamptz
         and not exists (select 1 from messages m where m.conversation_id = v.id);
      v_retidas := v_retidas || jsonb_build_object('conversa', v_linha.registro_id, 'motivo', v_apontada);
    end if;
  end loop;

  alter table public.conversations enable trigger set_updated_at;

  return jsonb_build_object(
    'mensagens', v_msgs, 'restam', 0, 'mensagens_citadas_retidas', v_citadas,
    'conversas_apagadas', v_convs, 'previas_devolvidas', v_previas,
    'orfas_limpas', v_orfas,
    'retidas', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_retidas) e limit 50) x),
    'retidas_total', jsonb_array_length(v_retidas),
    'desfez', true, 'terminou', true);
end;
$$;

revoke execute on function public.cb_historico_conversa_apontada(uuid)
  from public, anon, authenticated;
grant  execute on function public.cb_historico_conversa_apontada(uuid)
  to service_role;
revoke execute on function public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant  execute on function public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)
  to service_role;
revoke execute on function public.cb_desfazer_historico_whatsapp(uuid, text, boolean, int)
  from public, anon, authenticated;
grant  execute on function public.cb_desfazer_historico_whatsapp(uuid, text, boolean, int)
  to service_role;

-- ------------------------------------------------------------
-- Conferência. As funções são CHAMADAS (regra 3 do CLAUDE.md) num subbloco que
-- se desfaz pela exceção própria P1033 — nada sobra no banco. Banco vazio pula.
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
    raise exception '1033: o registro não foi criado';
  end if;
  if has_function_privilege('anon', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cb_desfazer_historico_whatsapp(uuid, text, boolean, int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_desfazer_historico_whatsapp(uuid, text, boolean, int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cb_historico_conversa_apontada(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cb_historico_conversa_apontada(uuid)', 'EXECUTE') then
    raise exception '1033: as funções continuam executáveis pelo navegador';
  end if;
  if not has_function_privilege('service_role', 'public.cb_importar_historico_whatsapp(uuid, text, jsonb, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cb_desfazer_historico_whatsapp(uuid, text, boolean, int)', 'EXECUTE') then
    raise exception '1033: o service_role perdeu o EXECUTE';
  end if;
  if has_table_privilege('anon', 'migracao_kommo.historico_whatsapp', 'SELECT')
     or has_table_privilege('authenticated', 'migracao_kommo.historico_whatsapp', 'SELECT') then
    raise exception '1033: o registro está legível pelo navegador';
  end if;

  -- uma conversa ENCERRADA existente, para provar que nada nela muda além do fio
  select v.account_id, v.contact_id, v.id into v_conta, v_contato, v_conv
    from conversations v
   where v.contact_id is not null and v.status = 'closed'
   limit 1;
  if v_conv is null then
    raise notice '1033: banco sem conversa encerrada de contato — a chamada não foi provada aqui.';
    return;
  end if;

  begin
    select status, unread_count, aguardando_desde, assigned_agent_id, last_message_at, updated_at
      into v_antes from conversations where id = v_conv;

    v_r := public.cb_importar_historico_whatsapp(v_conta, 'conferencia-1033', jsonb_build_array(
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1033-a',
        'sender_type', 'customer', 'from_me', false, 'from_device', false,
        'content_type', 'text', 'content_text', 'conferência', 'status', 'delivered',
        'created_at', '2026-01-02T12:00:00Z', 'previa', 'conferência'),
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1033-b',
        'sender_type', 'agent', 'from_me', true, 'from_device', true,
        'content_type', 'text', 'content_text', 'resposta', 'status', 'read',
        'created_at', '2026-01-02T12:01:00Z', 'cita', 'conferencia-1033-a',
        'edited_at', '2026-01-02T12:02:00Z'),
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1033-c',
        'sender_type', 'customer', 'from_me', false, 'from_device', false,
        'content_type', 'text', 'content_text', 'apagada', 'status', 'delivered',
        'created_at', '2026-01-02T12:03:00Z', 'deleted_at', '2026-01-02T12:04:00Z',
        'deleted_by', 'customer')));
    if (v_r->>'inseridas')::int <> 3 or (v_r->>'citacoes')::int <> 1 then
      raise exception '1033: a importação devolveu %', v_r;
    end if;

    select status, unread_count, aguardando_desde, assigned_agent_id, last_message_at, updated_at
      into v_depois from conversations where id = v_conv;
    if v_depois.status <> v_antes.status
       or v_depois.unread_count is distinct from v_antes.unread_count
       or v_depois.aguardando_desde is distinct from v_antes.aguardando_desde
       or v_depois.assigned_agent_id is distinct from v_antes.assigned_agent_id
       or v_depois.updated_at is distinct from v_antes.updated_at then
      raise exception '1033: a importação mexeu na conversa (situação, não lidas, espera, responsável ou updated_at)';
    end if;
    if exists (select 1 from messages where conversation_id = v_conv
                and message_id like 'conferencia-1033-%' and gravada_em is not null) then
      raise exception '1033: a mensagem importada nasceu com gravada_em';
    end if;
    if not exists (select 1 from messages where conversation_id = v_conv
                    and message_id = 'conferencia-1033-c' and deleted_by = 'customer' and deleted_at is not null)
       or not exists (select 1 from messages where conversation_id = v_conv
                       and message_id = 'conferencia-1033-b' and edited_at is not null) then
      raise exception '1033: a apagada ou a editada perdeu a marca';
    end if;

    select count(*) into v_ligados from pg_trigger
     where tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
       and not tgisinternal and tgenabled = 'D';
    if v_ligados > 0 then
      raise exception '1033: % gatilho(s) de messages/conversations ficaram desligados', v_ligados;
    end if;

    v_r2 := public.cb_importar_historico_whatsapp(v_conta, 'conferencia-1033', jsonb_build_array(
      jsonb_build_object('contact_id', v_contato, 'message_id', 'conferencia-1033-a',
        'sender_type', 'customer', 'content_type', 'text', 'content_text', 'conferência',
        'status', 'delivered', 'created_at', '2026-01-02T12:00:00Z')));
    if (v_r2->>'inseridas')::int <> 0 then
      raise exception '1033: a reimportação duplicou (%)', v_r2;
    end if;

    -- o desfazer em pedaços: de 2 em 2, até terminar
    v_r2 := public.cb_desfazer_historico_whatsapp(v_conta, 'conferencia-1033', false, 2);
    if (v_r2->>'terminou')::boolean or (v_r2->>'restam')::int <> 1 then
      raise exception '1033: o primeiro pedaço do desfazer devolveu %', v_r2;
    end if;
    v_r2 := public.cb_desfazer_historico_whatsapp(v_conta, 'conferencia-1033', false, 2);
    if not (v_r2->>'terminou')::boolean
       or exists (select 1 from messages where conversation_id = v_conv and message_id like 'conferencia-1033-%') then
      raise exception '1033: o desfazer não terminou (%)', v_r2;
    end if;
    if (select last_message_at from conversations where id = v_conv) is distinct from v_antes.last_message_at
       or (select updated_at from conversations where id = v_conv) is distinct from v_antes.updated_at then
      raise exception '1033: o desfazer não devolveu a prévia, ou empurrou updated_at';
    end if;
    if public.cb_historico_conversa_apontada(v_conv) is distinct from public.cb_historico_conversa_apontada(v_conv) then
      raise exception '1033: a consulta de quem aponta para a conversa não é determinística';
    end if;

    raise exception using errcode = 'P1033', message = 'conferência desfeita';
  exception when sqlstate 'P1033' then
    null;
  end;
  raise notice '1033: importação, reimportação e desfazer em pedaços conferidos numa conversa encerrada (desfeito).';
end $$;
