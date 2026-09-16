-- ============================================================
-- 1002 — Atraso de ENTREGA por conexão.
--
-- A saúde das conexões respondia "está de pé?" por dois caminhos (o estado
-- que o provedor reporta e o frescor dessa informação) e não respondia
-- "está entregando em dia?". MEDIDO em 16/09/2026: a conexão
-- Bancário - Comercial passou a manhã `open`, webhook apontado para cá,
-- frescor novo — verde em tudo — com o WhatsApp entregando as mensagens à
-- Evolution 29 MINUTOS atrasadas. Quem percebeu foi o operador, estranhando
-- o relógio da mensagem na tela.
--
-- Guardamos a FRONTEIRA DE ENTREGA: o carimbo do WhatsApp da mensagem mais
-- nova já entregue, e o instante em que o CRM a gravou. O atraso é a
-- diferença, calculada na leitura — a régua vive em
-- `src/lib/cb-channels/atraso-de-entrega.ts`, com teste.
--
-- Duas colunas, e não uma de "atraso em segundos", porque o par responde
-- uma pergunta que o número sozinho não responde: HÁ QUANTO TEMPO essa
-- medição foi feita. Conexão parada por falta de movimento e conexão
-- represada dariam o mesmo número; só o par as separa, e afirmar "em dia"
-- sobre uma medição de ontem é o erro que este arquivo existe para evitar.
--
-- ⚠️ NADA É RETROATIVO, de propósito: `messages.created_at` guarda o
-- carimbo do WhatsApp (a ingestão o sobrescreve), e o instante da gravação
-- não existe em lugar nenhum para o acervo. Um backfill teria de inventar
-- um dos dois lados. As conexões nascem sem fronteira e a primeira
-- mensagem de cada uma a estabelece — até lá o atraso é `null`, que a tela
-- trata como "não sei", nunca como "em dia".
--
-- ⚠️ ADITIVA: o app anterior não lê estas colunas e segue funcionando. O
-- app novo trata ausência como "não sei". Pode entrar antes ou depois do
-- deploy.
-- ============================================================

alter table public.cb_channels
  add column if not exists entrega_carimbo_em  timestamptz,
  add column if not exists entrega_recebida_em timestamptz;

comment on column public.cb_channels.entrega_carimbo_em is
  'Carimbo do WhatsApp da mensagem mais nova já entregue nesta conexão. Só AVANÇA: conexão represada drena o backlog fora de ordem, e aceitar retrocesso apagaria o alarme que a mensagem anterior acendeu.';

comment on column public.cb_channels.entrega_recebida_em is
  'Quando o CRM gravou a mensagem de `entrega_carimbo_em`. A diferença entre as duas é o atraso de entrega; a idade desta coluna diz se a medição ainda vale.';

-- ============================================================
-- Conferência.
--
-- Afirma só o que é verdade em banco VAZIO (as duas colunas existem e o
-- realtime está como esperado) e DERIVA qualquer dado, pulando com NOTICE
-- quando não houver — a regra que fez nove migrations nossas reprovarem no
-- primeiro replay do CI.
--
-- Não há REVOKE aqui, logo não há GRANT a devolver: coluna nova herda os
-- privilégios da tabela, e `cb_channels` já foi fechada para `anon` na 931.
-- ============================================================
do $$
declare
  v_colunas   int;
  v_publicada boolean;
  v_canais    int;
begin
  select count(*) into v_colunas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'cb_channels'
     and column_name in ('entrega_carimbo_em', 'entrega_recebida_em');
  if v_colunas <> 2 then
    raise exception '1002: esperava as 2 colunas da fronteira, achei %', v_colunas;
  end if;

  -- `anon` não pode ter ganhado nada por tabela nova ou grant de default.
  if has_table_privilege('anon', 'public.cb_channels', 'SELECT') then
    raise exception '1002: anon enxerga cb_channels — a 931 deveria ter fechado';
  end if;

  -- ⚠️ A 909 pôs `cb_channels` na publicação realtime com LISTA FIXA de
  -- colunas, então as duas novas NÃO viajam no payload. Isso é esperado e
  -- não quebra nada: `use-channel-health` refaz a sonda ao receber o
  -- evento em vez de aplicar o payload. A conferência existe para o
  -- próximo leitor não concluir que o realtime passou a carregá-las.
  select exists (
    select 1 from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
     where p.pubname = 'supabase_realtime' and c.relname = 'cb_channels'
  ) into v_publicada;
  if v_publicada then
    raise notice '1002: cb_channels está na publicação realtime (lista de colunas da 909 — as colunas novas não viajam no payload, por desenho).';
  else
    raise notice '1002: cb_channels não está na publicação realtime neste banco.';
  end if;

  select count(*) into v_canais from public.cb_channels;
  if v_canais = 0 then
    raise notice '1002: banco sem conexões, nada a medir.';
  else
    raise notice '1002: % conexões começam sem fronteira; a primeira mensagem de cada uma a estabelece.', v_canais;
  end if;
end $$;
