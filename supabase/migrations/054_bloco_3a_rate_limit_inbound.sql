-- ============================================================
-- 054_bloco_3a_rate_limit_inbound.sql — limite de mensagens inbound
-- antes da IA responder, para proteger o WhatsApp Business (número
-- exposto num anúncio pago) contra inundação por um único número ou
-- por vários números falsos.
--
-- Contexto: pedido do Ricardo (21/09/2026), campanha de anúncios a
-- arrancar às 9h30 do mesmo dia. Objectivo: nunca deixar de guardar
-- uma mensagem recebida (a equipa continua a ver tudo no inbox), mas
-- não chamar a IA (nem gastar tokens) quando um número está a abusar.
--
-- Dois limites, ambos configuráveis por conta em `ai_configs`:
--   1) rate_limit_messages_per_minute — mensagens por minuto de UM
--      número antes de a IA deixar de responder a esse número
--      (continua a guardar as mensagens). Isento: números em
--      `team_phone_numbers` e `notify_phone_numbers`.
--   2) rate_limit_new_numbers_per_hour — números NOVOS distintos por
--      hora, para toda a conta, antes de a IA deixar de responder aos
--      seguintes (protege contra inundação com números diferentes).
--
-- Contadores em BASE DE DADOS (não em memória) — o container pode
-- reiniciar e pode correr mais do que uma instância. A tabela
-- `rate_limit_buckets` guarda um contador por (chave, janela fixa),
-- incrementado atomicamente por `rate_limit_increment_and_check`
-- (INSERT ... ON CONFLICT DO UPDATE, atómico em Postgres por bloqueio
-- de linha — dois pedidos simultâneos nunca passam os dois).
--
-- Janela fixa (não deslizante): a app trunca o timestamp ao minuto
-- (limite 1) ou à hora (limite 2) e passa esse valor como
-- `p_window_start`. Linhas antigas não são limpas automaticamente
-- nesta migração — tabela pequena e de crescimento lento (uma linha
-- por conta+minuto/hora com tráfego), aceitável para já; limpeza
-- periódica pode ser adicionada depois se necessário.
--
-- À prova de falha: ver src/lib/ai/inbound-rate-limit.ts — qualquer
-- erro a chamar esta função DEIXA PASSAR (nunca bloqueia uma mensagem
-- legítima por um erro nosso).
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS rate_limit_messages_per_minute integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS rate_limit_new_numbers_per_hour integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN ai_configs.rate_limit_messages_per_minute IS
  'Máximo de mensagens por minuto de UM número antes de a IA deixar de responder a esse número (a mensagem continua a ser guardada). Isento: team_phone_numbers e notify_phone_numbers. Por omissão 10.';

COMMENT ON COLUMN ai_configs.rate_limit_new_numbers_per_hour IS
  'Máximo de números NOVOS distintos por hora, para toda a conta, antes de a IA deixar de responder aos seguintes números novos (a mensagem continua a ser guardada). Por omissão 60.';

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

COMMENT ON TABLE public.rate_limit_buckets IS
  'Contadores de limite de mensagens (janela fixa por chave), usados pelo webhook do WhatsApp para travar a IA sem travar o registo da mensagem. Ver src/lib/ai/inbound-rate-limit.ts.';

-- Só o service role (webhook) mexe nesta tabela — sem políticas
-- definidas, RLS activo bloqueia todo o acesso excepto ao service role
-- (que ignora RLS), mesmo padrão de outras tabelas internas do agente.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Incremento atómico com upsert: a primeira chamada numa janela cria a
-- linha com count=1; chamadas seguintes incrementam. Devolve o novo
-- valor de count — a app compara com o limite configurado. Um único
-- INSERT ... ON CONFLICT é atómico em Postgres (bloqueio de linha),
-- por isso dois pedidos simultâneos para a mesma chave nunca resultam
-- em contagem perdida.
CREATE OR REPLACE FUNCTION public.rate_limit_increment_and_check(
  p_bucket_key text,
  p_window_start timestamptz
)
RETURNS integer AS $$
  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, count)
  VALUES (p_bucket_key, p_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- O webhook corre sob o cliente service-role (sem auth.uid()), por
-- isso precisa de EXECUTE explícito — mesma razão e mesmo padrão da
-- grant em claim_ai_reply_slot (migração 031).
GRANT EXECUTE ON FUNCTION public.rate_limit_increment_and_check(text, timestamptz) TO service_role;
