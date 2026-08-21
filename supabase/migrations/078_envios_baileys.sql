-- ============================================================
-- 078_envios_baileys.sql — "Envios": a second WhatsApp send channel,
-- pessoal (não a API oficial da Meta), executado com Baileys embutido
-- no próprio processo do WACRM (sem serviço externo — o Hostinger
-- deste fork é Node.js gerenciado, sem Docker/VPS).
--
-- Não é uma evolução de `broadcasts` (diferente da migration 076, que
-- adicionou send_channel='external' na mesma tabela) — o motor de fila
-- com delay aleatório entre envios não tem nada em comum com o motor
-- de broadcast existente, então ganha tabelas próprias:
--
--   baileys_sessao       — uma sessão WhatsApp pareada por conta
--                           (settings-class, mesmo nível de
--                           whatsapp_config: select member, write admin).
--   baileys_sessao_keys  — chaves de sinal do Baileys (SignalKeyStore),
--                           granular por (tipo, key_id) em vez de um
--                           blob único — evita reescrever tudo a cada
--                           atualização de uma única chave.
--   envios               — um envio = uma mensagem (texto + imagem
--                           opcional) + até 2 lotes de leads.
--   envio_lotes           — filha de envios, sem account_id próprio
--                           (RLS via EXISTS join no pai, como
--                           broadcast_recipients).
--   envio_leads           — filha de envio_lotes, mesmo padrão.
--
-- Toda credencial/segredo (creds + signal keys do Baileys) é
-- criptografada com o mesmo encrypt()/decrypt() (AES-256-GCM,
-- ENCRYPTION_KEY) já usado para whatsapp_config.access_token — ver
-- src/lib/whatsapp/encryption.ts. Nenhum mecanismo de segredo novo.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ============================================================
-- baileys_sessao
-- ============================================================
CREATE TABLE IF NOT EXISTS baileys_sessao (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'principal' hoje; o desenho permite um número reserva no futuro
  -- (spec) sem migration nova — só outro identificador na mesma conta.
  identificador TEXT NOT NULL DEFAULT 'principal',
  status_conexao TEXT NOT NULL DEFAULT 'desconectado'
    CHECK (status_conexao IN ('desconectado', 'pareando', 'conectado')),
  -- JSON de AuthenticationCreds (via BufferJSON.replacer do Baileys),
  -- depois encrypt(). NULL só entre a criação da linha e o primeiro
  -- creds.update do Baileys.
  creds_criptografado TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, identificador)
);

CREATE INDEX IF NOT EXISTS idx_baileys_sessao_account ON baileys_sessao(account_id);

ALTER TABLE baileys_sessao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS baileys_sessao_select ON baileys_sessao;
DROP POLICY IF EXISTS baileys_sessao_insert ON baileys_sessao;
DROP POLICY IF EXISTS baileys_sessao_update ON baileys_sessao;
DROP POLICY IF EXISTS baileys_sessao_delete ON baileys_sessao;
CREATE POLICY baileys_sessao_select ON baileys_sessao FOR SELECT USING (is_account_member(account_id));
CREATE POLICY baileys_sessao_insert ON baileys_sessao FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY baileys_sessao_update ON baileys_sessao FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY baileys_sessao_delete ON baileys_sessao FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON baileys_sessao;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON baileys_sessao
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- baileys_sessao_keys — Baileys SignalKeyStore, granular
-- ============================================================
CREATE TABLE IF NOT EXISTS baileys_sessao_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sessao_id UUID NOT NULL REFERENCES baileys_sessao(id) ON DELETE CASCADE,
  -- SignalDataTypeMap key: 'pre-key' | 'session' | 'sender-key' |
  -- 'sender-key-memory' | 'app-state-sync-key' | 'app-state-sync-version'.
  tipo TEXT NOT NULL,
  key_id TEXT NOT NULL,
  valor_criptografado TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sessao_id, tipo, key_id)
);

CREATE INDEX IF NOT EXISTS idx_baileys_sessao_keys_lookup ON baileys_sessao_keys(sessao_id, tipo);

ALTER TABLE baileys_sessao_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS baileys_sessao_keys_all ON baileys_sessao_keys;
-- Signal keys are written/read only by the service-role client inside
-- src/lib/baileys/auth-state.ts (no browser call site ever touches this
-- table), but RLS is still enabled with a real policy — belt-and-
-- braces consistent with every other table here, and it's what lets a
-- future admin-role UI query (e.g. key counts) work without extra grants.
CREATE POLICY baileys_sessao_keys_all ON baileys_sessao_keys FOR ALL USING (
  EXISTS (SELECT 1 FROM baileys_sessao s WHERE s.id = baileys_sessao_keys.sessao_id AND is_account_member(s.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM baileys_sessao s WHERE s.id = baileys_sessao_keys.sessao_id AND is_account_member(s.account_id, 'admin'))
);

-- ============================================================
-- envios
-- ============================================================
CREATE TABLE IF NOT EXISTS envios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Referência opcional a uma Campanha existente (spec: "se aplicável")
  -- — puramente informativa, nada no motor de envio depende dela.
  campanha_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'em_andamento', 'concluido')),
  canal TEXT NOT NULL DEFAULT 'baileys' CHECK (canal = 'baileys'),
  mensagem_texto TEXT NOT NULL,
  mensagem_imagem_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_envios_account ON envios(account_id);
CREATE INDEX IF NOT EXISTS idx_envios_campanha ON envios(campanha_id) WHERE campanha_id IS NOT NULL;

ALTER TABLE envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS envios_select ON envios;
DROP POLICY IF EXISTS envios_insert ON envios;
DROP POLICY IF EXISTS envios_update ON envios;
DROP POLICY IF EXISTS envios_delete ON envios;
CREATE POLICY envios_select ON envios FOR SELECT USING (is_account_member(account_id));
CREATE POLICY envios_insert ON envios FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY envios_update ON envios FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY envios_delete ON envios FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- envio_lotes — filha de envios, sem account_id próprio
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_lotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  envio_id UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  numero_lote SMALLINT NOT NULL CHECK (numero_lote IN (1, 2)),
  quantidade_leads INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'em_andamento', 'pausado', 'concluido')),
  iniciado_em TIMESTAMPTZ,
  concluido_em TIMESTAMPTZ,
  UNIQUE (envio_id, numero_lote)
);

CREATE INDEX IF NOT EXISTS idx_envio_lotes_envio ON envio_lotes(envio_id);
-- What GET /api/envios/cron scans for "is any lote already running".
CREATE INDEX IF NOT EXISTS idx_envio_lotes_status_em_andamento ON envio_lotes(status) WHERE status = 'em_andamento';

ALTER TABLE envio_lotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS envio_lotes_select ON envio_lotes;
DROP POLICY IF EXISTS envio_lotes_modify ON envio_lotes;
CREATE POLICY envio_lotes_select ON envio_lotes FOR SELECT USING (
  EXISTS (SELECT 1 FROM envios e WHERE e.id = envio_lotes.envio_id AND is_account_member(e.account_id))
);
CREATE POLICY envio_lotes_modify ON envio_lotes FOR ALL USING (
  EXISTS (SELECT 1 FROM envios e WHERE e.id = envio_lotes.envio_id AND is_account_member(e.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM envios e WHERE e.id = envio_lotes.envio_id AND is_account_member(e.account_id, 'agent'))
);

-- ------------------------------------------------------------
-- Trava "uma campanha ativa por vez" — banco, não só endpoint.
--
-- Ao transicionar um lote para 'em_andamento', rejeita se já existir
-- outro lote 'em_andamento' na MESMA conta (join em envios). Cobre ao
-- mesmo tempo a regra "não rodar dois envios no mesmo dia" e a regra
-- anti-bloqueio "nunca dois lotes em paralelo" (spec seções 3 e 5) —
-- uma trava mais estrita que ambas satisfaz as duas. O endpoint de
-- iniciar lote checa isso antes também, para devolver um 409 legível
-- em vez de deixar este RAISE EXCEPTION estourar pro cliente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_single_active_lote()
RETURNS TRIGGER AS $$
DECLARE
  target_account_id UUID;
  conflicting_count INTEGER;
BEGIN
  IF NEW.status = 'em_andamento' AND (OLD.status IS DISTINCT FROM 'em_andamento') THEN
    SELECT account_id INTO target_account_id FROM envios WHERE id = NEW.envio_id;

    SELECT COUNT(*) INTO conflicting_count
    FROM envio_lotes el
    JOIN envios e ON e.id = el.envio_id
    WHERE e.account_id = target_account_id
      AND el.status = 'em_andamento'
      AND el.id != NEW.id;

    IF conflicting_count > 0 THEN
      RAISE EXCEPTION 'Já existe um lote em andamento nesta conta — só um envio ativo por vez'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_single_active_lote ON envio_lotes;
CREATE TRIGGER trg_check_single_active_lote
  BEFORE UPDATE ON envio_lotes
  FOR EACH ROW EXECUTE FUNCTION check_single_active_lote();

-- ============================================================
-- envio_leads — filha de envio_lotes, mesmo padrão de RLS
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_id UUID NOT NULL REFERENCES envio_lotes(id) ON DELETE CASCADE,
  nome TEXT,
  telefone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'na_fila'
    CHECK (status IN ('na_fila', 'enviando', 'enviado', 'falhou')),
  -- Quando o cron tick (GET /api/envios/cron) deve tentar este lead a
  -- seguir. NULL = ainda não agendado (lotes aguardando, ou leads mais
  -- adiante na fila de um lote em andamento). Mirror de
  -- automation_pending_executions.run_at.
  next_attempt_at TIMESTAMPTZ,
  enviado_em TIMESTAMPTZ,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- O que o cron tick escaneia: leads na_fila com next_attempt_at vencido.
CREATE INDEX IF NOT EXISTS idx_envio_leads_due ON envio_leads(lote_id, status, next_attempt_at);

ALTER TABLE envio_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS envio_leads_select ON envio_leads;
DROP POLICY IF EXISTS envio_leads_modify ON envio_leads;
CREATE POLICY envio_leads_select ON envio_leads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM envio_lotes el JOIN envios e ON e.id = el.envio_id
    WHERE el.id = envio_leads.lote_id AND is_account_member(e.account_id)
  )
);
CREATE POLICY envio_leads_modify ON envio_leads FOR ALL USING (
  EXISTS (
    SELECT 1 FROM envio_lotes el JOIN envios e ON e.id = el.envio_id
    WHERE el.id = envio_leads.lote_id AND is_account_member(e.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM envio_lotes el JOIN envios e ON e.id = el.envio_id
    WHERE el.id = envio_leads.lote_id AND is_account_member(e.account_id, 'agent')
  )
);
