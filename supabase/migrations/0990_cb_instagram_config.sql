-- 990_cb_instagram_config.sql
--
-- O aplicativo da Meta por trás das conexões de Instagram Direct — a
-- credencial que o login do Instagram (Business Login for Instagram, OAuth)
-- exige ANTES de existir qualquer canal: o Instagram App ID (público, vai
-- na URL de autorização) e o Instagram App Secret (troca o código pelo
-- token e assina os webhooks). Até aqui o segredo era digitado POR CANAL
-- (989, `cb_channels.ig_app_secret`), porque o token vinha colado do painel
-- da Meta; com o login do Instagram o operador cadastra o app UMA vez e
-- cada conta profissional do escritório entra por "Conectar com Instagram".
-- O canal criado pelo login continua gravando o segredo em
-- `cb_channels.ig_app_secret` — a rota do webhook lê de lá, e o caminho do
-- token colado segue existindo (docs/PLANO-instagram-direct.md, D3).
--
-- UMA linha por conta, FECHADA para o navegador (nenhuma policy, nenhum
-- GRANT a `authenticated`), como a 976/977/987: o segredo é CIFRADO com
-- `encrypt()` de `src/lib/whatsapp/encryption.ts` (AES-256-GCM,
-- `ENCRYPTION_KEY` — rotacionar a chave invalida esta junto com as demais)
-- e a tela lê pela rota `/api/cb/instagram/app`, que devolve só o App ID.
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda. Idempotente.

CREATE TABLE IF NOT EXISTS cb_instagram_config (
  account_id     uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- O App ID da Meta é numérico. A forma é conferida aqui para um valor
  -- colado com espaço, ou o NOME do app, não virar uma URL de autorização
  -- que o Instagram responde com página de erro sem código nenhum.
  ig_app_id      text NOT NULL CHECK (ig_app_id ~ '^[0-9]{5,32}$'),
  ig_app_secret  text NOT NULL,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_instagram_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_instagram_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_instagram_config TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cb_instagram_config'
  ) THEN
    RAISE EXCEPTION '990: tabela cb_instagram_config ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'cb_instagram_config' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION '990: RLS desligada em cb_instagram_config';
  END IF;

  IF has_table_privilege('anon', 'public.cb_instagram_config', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_instagram_config', 'INSERT') THEN
    RAISE EXCEPTION '990: anon ainda alcança cb_instagram_config';
  END IF;

  -- Fechada: o segredo cifrado não passa pelo PostgREST.
  IF has_table_privilege('authenticated', 'public.cb_instagram_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_instagram_config', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_instagram_config', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_instagram_config', 'DELETE') THEN
    RAISE EXCEPTION '990: authenticated alcança cb_instagram_config — tudo passa pela rota';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_instagram_config', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_instagram_config', 'SELECT') THEN
    RAISE EXCEPTION '990: service_role sem acesso a cb_instagram_config';
  END IF;
END $$;
