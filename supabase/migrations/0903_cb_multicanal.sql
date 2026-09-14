-- ============================================================
-- 903_cb_multicanal — escopo de canal nas camadas de REGRA e DISPARO.
--
-- A 901/902 levaram o multi-canal até o transporte (conversa -> canal ->
-- credencial). Fora desse eixo o app seguia monocanal: nenhuma tabela de
-- regra ou disparo tinha coluna de canal, então uma automação criada para o
-- número Comercial disparava também no celular pessoal do sócio, e um
-- broadcast saía sempre pelo canal padrão sem escolha nem registro.
--
-- PRINCÍPIO TRANSVERSAL — toda coluna de canal aqui é NULLABLE, e NULL
-- significa sempre "QUALQUER canal / herda o padrão", nunca "nenhum canal".
-- É o que preserva 100% do comportamento das linhas existentes sem backfill
-- obrigatório, e o que mantém a conta de UM canal (o caso de produção hoje)
-- funcionando exatamente como antes.
--
-- Toda FK para cb_channels usa ON DELETE SET NULL, seguindo o padrão já
-- estabelecido em 902: apagar um canal degrada a regra para "qualquer
-- canal", nunca apaga a regra.
--
-- Idempotente: roda mais de uma vez sem erro (IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Escopo de disparo e execução
-- ------------------------------------------------------------

-- Array e não tabela de junção: o filtro é uma linha de código no dispatch,
-- e uma junção para isso seria abstração prematura. NULL = todos os canais.
-- Array VAZIO nunca deve existir — o trigger da seção 6 normaliza para NULL
-- e desativa a automação, senão ela passaria a disparar em TODOS os números,
-- o oposto exato da intenção de quem a restringiu a um canal.
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS channel_ids uuid[];

COMMENT ON COLUMN automations.channel_ids IS
  'Canais (cb_channels.id) em que esta automação pode disparar. NULL = todos. Array vazio é estado inválido — ver trigger cb_automations_drop_channel.';

-- Sem isto, "por que isso respondeu pelo número errado?" não tem resposta na
-- tela de logs.
ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- NULL = flow curinga (dispara em qualquer canal). Com um valor, o gatilho
-- só casa naquele canal — é o que permite dois flows com a MESMA palavra-chave
-- em números diferentes, hoje impossível.
ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- Trava o canal do RUN. Os nós de envio passam a usar o canal do run em vez
-- de re-resolver pela conversa a cada nó — senão, o cliente que responde por
-- outro número no meio do atendimento faz o bot trocar de identidade.
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flows_channel_idx
  ON flows (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS flow_runs_channel_idx
  ON flow_runs (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automations_channel_ids_idx
  ON automations USING gin (channel_ids);

-- ------------------------------------------------------------
-- 2) Templates e broadcasts
-- ------------------------------------------------------------

-- Templates da Meta são POR WABA. Sem dono de canal, um catálogo de um WABA
-- era usado no outro: o atendente via o preview certo e o cliente recebia
-- outra coisa (ou a Meta devolvia "template does not exist").
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- O canal é da campanha inteira. broadcast_recipients NÃO precisa da coluna:
-- idx_broadcast_recipients_wamid já é único global, então não há ambiguidade
-- de ACK.
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS message_templates_channel_idx
  ON message_templates (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcasts_channel_idx
  ON broadcasts (channel_id) WHERE channel_id IS NOT NULL;

-- Backfill condicional: um template só pode pertencer a um canal META (a
-- Evolution não tem catálogo aprovado). Se o padrão da conta for Evolution,
-- os templates ficam NULL = "vale para qualquer canal Meta", que é o
-- comportamento antigo.
UPDATE message_templates t
   SET channel_id = c.id
  FROM cb_channels c
 WHERE c.account_id = t.account_id
   AND c.is_default
   AND c.kind = 'meta'
   AND t.channel_id IS NULL;

-- O UNIQUE antigo (user_id, name, language) impediria o MESMO nome de
-- template em dois WABAs — exatamente o que passa a ser legítimo. Vira dois
-- índices parciais: um para os globais (channel_id NULL) e outro por canal.
-- NB: é índice, não constraint (conferido em pg_constraint), então DROP INDEX.
DROP INDEX IF EXISTS message_templates_user_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_lang_global_key
  ON message_templates (user_id, name, language)
  WHERE channel_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_lang_channel_key
  ON message_templates (user_id, channel_id, name, language)
  WHERE channel_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) IA por canal
-- ------------------------------------------------------------

-- O interruptor de maior retorno e menor custo: o sócio conecta o WhatsApp
-- pessoal pelo QR e a IA começa a responder os contatos dele sozinha, sem
-- nenhum botão para impedir. DEFAULT true preserva o comportamento atual.
ALTER TABLE cb_channels
  ADD COLUMN IF NOT EXISTS ai_autoreply_enabled boolean NOT NULL DEFAULT true;

-- Roteamento por canal ("canal Jurídico -> time Jurídico"), usado tanto na
-- criação da conversa quanto no handoff da IA. NULL = sem roteamento.
ALTER TABLE cb_channels
  ADD COLUMN IF NOT EXISTS default_agent_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Um agente por canal. NULL = o agente PADRÃO da conta (o que existe hoje).
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- Base de conhecimento por canal: hoje é global, então um lead que pergunta
-- honorários no Comercial pode receber trecho da tabela interna do Jurídico.
-- NULL = documento comum a todos os canais.
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- Denormalizado do documento, como já se faz com account_id — a busca
-- vetorial não pode pagar um JOIN por chunk.
ALTER TABLE ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- Atribuição de custo por número.
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS channel_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

-- ai_configs era UNIQUE(account_id) — um único agente por conta, a raiz de
-- "impossível ter agente A no comercial e B no jurídico". Vira: um agente
-- PADRÃO (channel_id NULL) + um agente por canal.
-- NB: aqui é CONSTRAINT (não índice solto), então DROP CONSTRAINT.
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_account_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS ai_configs_account_default_key
  ON ai_configs (account_id) WHERE channel_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_configs_account_channel_key
  ON ai_configs (account_id, channel_id) WHERE channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_channel_idx
  ON ai_knowledge_chunks (channel_id) WHERE channel_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4) Integridade canal <-> conta
-- ------------------------------------------------------------

-- conversations.channel_id é gravado direto do browser (seletor de canal na
-- conversa). A FK antiga só garantia "existe um canal com esse id" — não que
-- fosse um canal DESTA conta. A FK composta fecha o buraco.
CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_id_account_key
  ON cb_channels (id, account_id);

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_id_fkey;

-- ⚠️ ON DELETE SET NULL (channel_id) — a forma por COLUNA, do PG 15+.
-- Um `ON DELETE SET NULL` simples zeraria as DUAS colunas da FK, e
-- conversations.account_id é NOT NULL: apagar um canal derrubaria a
-- transação com violação de NOT NULL.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_account_fkey
  FOREIGN KEY (channel_id, account_id)
  REFERENCES cb_channels (id, account_id)
  ON DELETE SET NULL (channel_id);

-- Dois canais pareando o mesmo número na mesma conta é sempre engano do
-- operador, e produz roteamento de entrada ambíguo.
CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_account_phone_key
  ON cb_channels (account_id, display_phone)
  WHERE display_phone IS NOT NULL;

-- ------------------------------------------------------------
-- 5) RPCs de knowledge com filtro de canal
-- ------------------------------------------------------------
--
-- ⚠️ DROP + CREATE com o novo parâmetro tendo DEFAULT NULL é deliberado, e é
-- o que torna a migration segura de aplicar ANTES do deploy do app:
--   - chamada com 3 args (app em produção hoje) -> p_channel_id = NULL ->
--     nenhum filtro -> comportamento idêntico ao atual;
--   - chamada com 4 args (app novo) -> filtra por canal.
-- Um CREATE OR REPLACE não serviria (a assinatura muda), e criar um overload
-- deixaria a chamada de 3 args ambígua ("function is not unique").

DROP FUNCTION IF EXISTS match_ai_knowledge_semantic(uuid, text, integer);

CREATE FUNCTION match_ai_knowledge_semantic(
  p_account_id uuid,
  p_query_embedding text,
  p_match_count integer,
  p_channel_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, distance real)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
    -- NULL no chunk = documento comum a todos os canais; NULL no parâmetro =
    -- sem recorte. Nunca esconde o acervo pré-903.
    AND (p_channel_id IS NULL OR c.channel_id IS NULL OR c.channel_id = p_channel_id)
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$function$;

DROP FUNCTION IF EXISTS match_ai_knowledge_fts(uuid, text, integer);

CREATE FUNCTION match_ai_knowledge_fts(
  p_account_id uuid,
  p_query text,
  p_match_count integer,
  p_channel_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, rank real)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
    AND (p_channel_id IS NULL OR c.channel_id IS NULL OR c.channel_id = p_channel_id)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$function$;

-- ------------------------------------------------------------
-- 6) Triggers de limpeza ao remover um canal
-- ------------------------------------------------------------

-- Solta o pino ANTES do delete. Sem isto a conversa fica com
-- channel_id NULL e channel_pinned TRUE — estado morto, porque
-- followConversationChannel só move conversa despinada, e depois do delete
-- não haveria como encontrá-la (o vínculo já teria sido zerado pela FK).
-- A rota de DELETE já faz isso; o trigger garante para QUALQUER caminho,
-- inclusive SQL manual e cascata de conta.
CREATE OR REPLACE FUNCTION cb_unpin_conversations_on_channel_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE conversations
     SET channel_pinned = false
   WHERE channel_id = OLD.id
     AND channel_pinned;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_unpin_conversations ON cb_channels;
CREATE TRIGGER cb_channels_unpin_conversations
  BEFORE DELETE ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION cb_unpin_conversations_on_channel_delete();

-- Tira o canal removido do escopo das automações. ⚠️ Se ele era o ÚNICO
-- canal do array, o array esvazia — e um array vazio faria a automação
-- disparar em TODOS os números (o oposto da intenção de quem a restringiu).
-- Por isso, ao esvaziar, a automação é DESATIVADA em vez de virar curinga.
CREATE OR REPLACE FUNCTION cb_drop_channel_from_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE automations
     SET channel_ids = nullif(array_remove(channel_ids, OLD.id), '{}'),
         is_active = CASE
           WHEN nullif(array_remove(channel_ids, OLD.id), '{}') IS NULL
             THEN false
           ELSE is_active
         END
   WHERE channel_ids @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_drop_from_automations ON cb_channels;
CREATE TRIGGER cb_channels_drop_from_automations
  BEFORE DELETE ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION cb_drop_channel_from_automations();

-- Tudo em `public` vira RPC no PostgREST. O Postgres já recusa chamar função
-- de trigger fora de um trigger, e ambas são SECURITY DEFINER — então o
-- REVOKE é defesa em profundidade, e de quebra tira as duas do lint de
-- segurança do Supabase (0028/0029), em vez de somá-las ao ruído existente.
REVOKE EXECUTE ON FUNCTION cb_unpin_conversations_on_channel_delete()
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION cb_drop_channel_from_automations()
  FROM anon, authenticated;

-- ------------------------------------------------------------
-- 7) Deliberadamente FORA desta migration
-- ------------------------------------------------------------
--
-- * UNIQUE (conversation_id, message_id) em messages. Fecharia a duplicação
--   de inbound na raiz, mas transforma uma redelivery do webhook (que hoje
--   passa pelos checks de idempotência) num erro 23505 no caminho crítico do
--   insert. É bug real, porém independente do multi-canal — merece mudança
--   própria, com tratamento explícito do conflito.
--
-- * UNIQUE (account_id, contact_id, channel_id) em conversations. Hoje o
--   mesmo contato falando com dois números nossos vira UMA conversa
--   (idx_conversations_account_contact), decisão explícita da 902. Mudar isso
--   é troca de MODELO DE PRODUTO: exigiria migração de merge/split e refaria
--   inbox, atribuição e IA. Só com decisão do escritório.
--
-- * cb_channels.app_secret (número Meta de OUTRO App do Facebook). Como
--   META_APP_SECRET é global, esses números teriam 100% do inbound rejeitado
--   na verificação de assinatura. Cenário especulativo — a restrição deve ser
--   documentada no painel, não codificada agora.
