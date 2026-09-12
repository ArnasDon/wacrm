-- 991_cb_asaas_config.sql
--
-- Asaas — a CONEXÃO, e só ela (docs/PLANO-integracao-asaas.md, Fase 1a).
--
-- O escritório cobra os honorários no Asaas. O plano inteiro (vínculo dos
-- clientes, aviso de inadimplência na conversa e régua de cobrança) depende
-- de duas coisas que ainda não existem: a chave da API guardada num lugar
-- seguro e o LEVANTAMENTO da conta real (§3.1), que é quem calibra as
-- decisões D2, D5 e D10. Esta migration entrega a primeira.
--
-- ⚠️ É UMA TABELA SÓ, de propósito. As outras duas do plano
-- (`cb_asaas_clientes` e `cb_asaas_cobrancas`) guardam o ESPELHO das
-- cobranças, e a forma delas é justamente o que o levantamento pode mudar —
-- quantos clientes casam por telefone (D5), o que fazer com quem não tem
-- ficha (D2), se `externalReference` está em uso (D9). Migration aplicada
-- não se renumera nem se reescreve: as duas nascem depois, com os números
-- medidos na mão.
--
-- `cb_asaas_config` — UMA linha por conta, FECHADA para o navegador
-- (nenhuma policy, nenhum GRANT a `authenticated`), como a 976/977/987/990:
--
--   - `api_key`: a chave da API do Asaas, CIFRADA com `encrypt()` de
--     `src/lib/whatsapp/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` —
--     ⚠️ rotacionar a chave invalida esta junto com as do WhatsApp, do Meta
--     Ads, do Calendly, do tl;dv e do Instagram). Vai no cabeçalho
--     `access_token` de cada pedido, NUNCA na URL: URL vaza em log de proxy.
--     A chave começa com `$` (`$aact_prod_…`) e o `$` faz parte dela.
--   - `chave_nome`: o NOME que a chave tem na tela do Asaas. ⚠️ Não é
--     enfeite: os eventos de chave do webhook (`ACCESS_TOKEN_DISABLED`,
--     `_EXPIRED`…) valem para QUALQUER chave da conta e só trazem
--     `accessToken.name` — sem o nome guardado, o CRM não saberia se o
--     evento é da chave dele ou da chave de outro sistema do escritório.
--   - `ambiente`: `producao` ou `sandbox`. ⚠️ O sandbox NÃO pode ser
--     conectado nesta instalação: o ambiente local grava no MESMO projeto
--     Supabase da produção e a config é uma linha por conta, então conectar
--     o sandbox aqui TROCARIA a conexão da produção. A coluna existe para
--     outras instalações, e o CHECK a documenta.
--   - `chave_expira_em`: só quando o operador põe validade à mão na chave.
--     ⚠️ O Asaas só avisa "chave expirando" no ciclo de INATIVIDADE (3 meses
--     sem uso), que o cron nunca deixa começar — com validade manual a
--     integração morreria no último dia, sem aviso nenhum. Guardada, o
--     cartão avisa antes.
--   - `status`/`last_error`: o que o cartão mostra. `last_error` guarda o
--     CÓDIGO (`chave_invalida`, `sem_permissao`, …), nunca a mensagem crua
--     do Asaas — a tela traduz, e a mensagem do provedor é justamente o
--     lugar por onde um segredo vaza para o log.
--   - `last_sync_at` (só no SUCESSO) e `last_sync_attempt_at` (carimbado no
--     COMEÇO de toda varredura, dê certo ou errado): as duas colunas do
--     rodízio do cron da 988. Ordenar as contas por TENTATIVA é o que faz a
--     conta que ficou de fora do orçamento de um ciclo ir para a frente do
--     seguinte; ordenar por SUCESSO deixaria a conta que falha na frente
--     para sempre. Nascem aqui, sem escritor ainda: quem as carimba é a
--     sincronização, que vem depois do levantamento.
--   - `vencidas_listadas_em` / `last_full_sync_at`: idem — o INÍCIO da
--     última listagem completa das vencidas e a última listagem completa de
--     clientes. Sem escritor até a sincronização existir.
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda. Idempotente.

CREATE TABLE IF NOT EXISTS cb_asaas_config (
  account_id            uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  api_key               text NOT NULL,
  chave_nome            text,
  ambiente              text NOT NULL DEFAULT 'producao' CHECK (ambiente IN ('producao', 'sandbox')),
  chave_expira_em       date,
  status                text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'erro')),
  last_sync_at          timestamptz,
  last_sync_attempt_at  timestamptz,
  vencidas_listadas_em  timestamptz,
  last_full_sync_at     timestamptz,
  last_error            text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_asaas_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_config TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cb_asaas_config'
  ) THEN
    RAISE EXCEPTION '991: tabela cb_asaas_config ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.cb_asaas_config'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '991: RLS desligada em cb_asaas_config';
  END IF;

  -- Fechada: a chave cifrada não passa pelo PostgREST, nem para ler.
  IF has_table_privilege('anon', 'public.cb_asaas_config', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_asaas_config', 'INSERT') THEN
    RAISE EXCEPTION '991: anon ainda alcança cb_asaas_config';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_asaas_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_config', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_config', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_asaas_config', 'DELETE') THEN
    RAISE EXCEPTION '991: authenticated alcança cb_asaas_config — tudo passa pela rota';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_asaas_config', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_asaas_config', 'SELECT') THEN
    RAISE EXCEPTION '991: service_role sem acesso a cb_asaas_config';
  END IF;
END $$;
