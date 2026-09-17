-- ============================================================
-- 1003 — Instante de GRAVAÇÃO da mensagem.
--
-- `messages.created_at` NÃO diz quando a mensagem chegou ao CRM: a ingestão o
-- sobrescreve com o carimbo do WhatsApp (`m.timestamp`), para o fio ordenar
-- pelo relógio de quem escreveu. O instante da gravação não existia em coluna
-- nenhuma — e sem ele não há como medir, mensagem a mensagem, o ATRASO DE
-- ENTREGA (carimbo → gravação) sobre o acervo: a 1002 guarda só a fronteira
-- ATUAL de cada conexão, e o log da Evolution roda a 30 MB (~2 dias) e morre
-- no reinício do contêiner.
--
-- Nasceu da investigação de 17/09/2026 (docs/PLANO-baileys-7.md, 5.10): a
-- Evolution 2.4 entregava 1 mensagem por minuto por conexão, e a correção
-- (patch na nossa imagem) precisa ser CONFERIDA sobre dias e sobre todas as
-- conexões, antes × depois, com o MESMO instrumento — este.
--
-- `DEFAULT now()`, preenchido pelo BANCO: nenhum caminho de ingestão escreve a
-- coluna — os quatro de entrada (Evolution ×2, Meta, Instagram) e o envio pelo
-- CRM a ganham sem uma linha de código. ⚠️ ADD sem default e SET DEFAULT
-- depois, de propósito: `ADD COLUMN ... DEFAULT now()` preencheria as linhas
-- ANTIGAS com o instante da migration, e o acervo inteiro pareceria gravado
-- hoje. As antigas ficam NULL ("não medido", nunca zero); a régua de leitura
-- filtra `gravada_em is not null`.
--
-- Leitura (o que a verificação roda — a consulta inteira está no 5.10):
--   gravada_em - created_at                        → atraso de entrega
--   sender_type = 'customer' OR from_device = true → só o que passou pela fila
--   de ENTRADA da Evolution (o envio pelo CRM nasce com as duas ≈ iguais).
--
-- ⚠️ ADITIVA: nenhum código lê ou escreve a coluna. Pode entrar antes ou
-- depois do deploy — e DEVE entrar antes do rollout da imagem corrigida, para
-- colher o "antes" com o mesmo instrumento. `messages` está na publicação
-- realtime SEM lista de colunas (conferido em 17/09): a coluna viaja no
-- payload, e é só um timestamp.
-- ============================================================

alter table public.messages
  add column if not exists gravada_em timestamptz;

alter table public.messages
  alter column gravada_em set default now();

comment on column public.messages.gravada_em is
  'Instante em que o CRM gravou a linha (DEFAULT now(), preenchido pelo banco). `created_at` é o carimbo do WhatsApp; a diferença é o atraso de entrega. NULL nas linhas anteriores à 1003 — "não medido", nunca zero.';

-- ============================================================
-- Conferência — afirma só o que é verdade em banco VAZIO.
--
-- Sem REVOKE, logo sem GRANT a devolver: a coluna herda os privilégios da
-- tabela (`messages` é do upstream, e o `anon` TEM SELECT nela — a RLS é a
-- barreira; não é esta migration que muda isso, e ela não afirma nada a
-- respeito). O dado é só REPORTADO (NOTICE), nunca exigido: numa reaplicação
-- já há linhas com valor, e exigir "nenhuma" quebraria a idempotência.
-- ============================================================
do $$
declare
  v_default   text;
  v_nullable  text;
  v_sem_valor bigint;
  v_com_valor bigint;
begin
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'messages' and column_name = 'gravada_em';

  if v_default is null then
    raise exception '1003: messages.gravada_em sem coluna ou sem default';
  end if;
  if v_default !~ '^now\(\)' then
    raise exception '1003: o default de gravada_em deveria ser now(), é %', v_default;
  end if;
  if v_nullable <> 'YES' then
    raise exception '1003: gravada_em precisa aceitar NULL (as linhas antigas são "não medido")';
  end if;

  select count(*) filter (where gravada_em is null),
         count(*) filter (where gravada_em is not null)
    into v_sem_valor, v_com_valor
    from public.messages;
  raise notice '1003: % mensagens sem instante de gravação (anteriores à coluna) e % com; as novas ganham now() no insert.',
    v_sem_valor, v_com_valor;
end $$;
