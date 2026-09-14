-- ============================================================
-- 911_cb_um_funil_por_vez.sql — a trava anti-duplicata deixa de ser por funil
--
-- POR QUE ESTA MIGRATION EXISTE
-- O modelo do produto é UM CARD POR CONTATO, que TRANSITA entre funis: o
-- operador move o lead do Bancário para o Trabalhista quando o assunto muda.
-- A conexão coloca o cliente num funil apenas na PRIMEIRA vez; depois disso,
-- quem manda é a decisão de quem moveu.
--
-- A trava criada pela 908 era `(account_id, contact_id, pipeline_id)`, e por
-- isso DESFAZIA a transferência:
--
--   1. cliente escreve no número Bancário → card nasce no funil Bancário
--   2. operador move o card para o funil Trabalhista
--   3. cliente escreve de novo → o roteador procura card no funil da CONEXÃO
--      (Bancário), não acha, e cria um SEGUNDO
--   4. o lead termina nos dois funis — exatamente o que "um funil por vez"
--      existe para impedir
--
-- Tirando `pipeline_id` da chave, o índice passa a garantir o invariante que
-- o produto quer: no máximo UM card por contato criado pelo roteador, em
-- qualquer funil. É a rede contra corrida; a regra semântica (que também
-- conta card manual e de automação) mora em pipeline-routing.ts.
--
-- ⚠️ ORDEM DAS OPERAÇÕES. O índice novo é criado ANTES de o antigo ser
-- derrubado, e a criação falha se já houver contato com dois cards de
-- `source='channel'`. É proposital: nesse caso a migration para e alguém
-- olha, em vez de a trava nascer silenciosamente ausente. Conferido em
-- 2026-07-27: produção tem 4 negócios, todos de contatos distintos.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- A trava nova. `contact_id IS NOT NULL` continua no predicado porque a
-- coluna é anulável (004) e NULL não colide com NULL em índice único — sem
-- o filtro o índice carregaria linhas que ele não pode restringir.
CREATE UNIQUE INDEX IF NOT EXISTS cb_deals_contato_canal_idx
  ON deals (account_id, contact_id)
  WHERE source = 'channel' AND contact_id IS NOT NULL;

-- Só então some a antiga, agora redundante: qualquer par que ela barrava é
-- barrado pela nova, que é mais restritiva.
DROP INDEX IF EXISTS cb_deals_canal_idx;

COMMENT ON INDEX cb_deals_contato_canal_idx IS
  'Um card por contato criado pelo roteador de entrada, em QUALQUER funil. '
  'O card transita entre funis; a conexao so o cria na primeira vez.';
