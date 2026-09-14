-- ============================================================
-- 940_cb_broadcast_com_canal.sql
--
-- Devolve o CANAL à criação de campanha.
--
-- POR QUE ESTA MIGRATION EXISTE
-- O merge do upstream (PRs #449 e #472) trouxe
-- `create_broadcast_with_recipients`: a criação da campanha e a dos
-- destinatários passam a acontecer numa transação só, para não sobrar
-- campanha órfã em `sending` quando o insert dos destinatários falha.
-- Boa mudança — mas o upstream não conhece multi-canal, e o INSERT dele
-- em `broadcasts` não carrega `channel_id`.
--
-- Trocar o nosso insert direto pela função deles sem isto faria TODA
-- campanha nascer com `channel_id NULL`. Nada quebraria na hora: o envio
-- continua saindo pelo canal certo, porque quem decide isso é o
-- `resolveMetaChannel` na aplicação. O que se perde é o REGISTRO — e o
-- histórico passa a mostrar travessão no lugar do número, exatamente o
-- que a 903 veio consertar. Regressão silenciosa, que só apareceria
-- quando alguém perguntasse "de qual número saiu essa campanha?".
--
-- O QUE ELA FAZ
-- Recria a função com um 9º parâmetro, `p_channel_id`, e o carimba na
-- linha de `broadcasts`. O resto é idêntico ao da 041 — inclusive o
-- `unnest` de dois arrays que congela os params por destinatário.
--
-- ⚠️ PRECISA RODAR DEPOIS DA 041. A 041 dropa a versão de 7 argumentos e
-- cria a de 8; esta cria a de 9. Como a faixa 900+ é aplicada depois da
-- faixa do upstream, a ordem natural já está correta.
--
-- ⚠️ A versão de 8 argumentos é DROPADA de propósito. Deixá-la viva daria
-- duas funções com o mesmo nome, e uma chamada nomeada que omitisse
-- `p_channel_id` cairia silenciosamente na que não carimba canal — o
-- mesmo bug, só que mais difícil de achar.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[],
  p_channel_id        UUID
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients, channel_id
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, p_channel_id
  )
  RETURNING id INTO v_broadcast_id;

  -- Two-array unnest pairs each contact with its params positionally.
  -- A shorter params array pads with NULL, which the resume path reads
  -- as "no params" — the same as a pre-041 row.
  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

-- Mesma trava da 041 e da nossa b24f8d3: só o service_role (webhook,
-- motor, rotas de servidor) executa. `SECURITY DEFINER` aberto ao papel
-- `authenticated` deixaria qualquer sessão criar campanha em qualquer
-- conta, ignorando a RLS.
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) TO service_role;
