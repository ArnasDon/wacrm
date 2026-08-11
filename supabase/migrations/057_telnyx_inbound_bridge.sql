-- ============================================================
-- 057_telnyx_inbound_bridge.sql — telefonía entrante (patrón de dos patas).
--
-- Hasta ahora el webhook de Telnyx solo hacía contabilidad sobre `calls`:
-- no contestaba, no creaba la segunda pata y no unía nada. Por eso el
-- softphone del navegador nunca recibía llamadas — nadie se las llevaba.
--
-- El patrón correcto (Telnyx Pattern 2) es: contestar la llamada PSTN
-- entrante (pata A), crear una SEGUNDA llamada hacia el cliente WebRTC
-- (pata B) y unirlas con `bridge`.
--
-- 1. telnyx_config — dos identificadores que faltaban
--
--    `credential_connection_id` es la pieza clave del "siempre ocupado"
--    (SIP 486 user_busy). Al crear la pata B hay que usar el connection_id
--    de la CONEXIÓN DE CREDENCIALES (la que autentica al softphone), NO el
--    de la Call Control App. La CCA sirve para recibir del exterior; la
--    conexión de credenciales es la que sabe enrutar hacia clientes WebRTC
--    registrados. Mandar la pata B a la CCA hace que el SIP no encuentre a
--    nadie y responda ocupado.
--
--    `agent_sip_uri` es el destino de esa pata B: sip:<usuario>@sip.telnyx.com.
--
--    Ambas nulables: una cuenta que solo use saliente + SMS sigue
--    funcionando igual, y el webhook se limita a la contabilidad de antes
--    mientras estén vacías.
--
-- 2. calls — emparejamiento de patas
--
--    El emparejamiento viaja sobre todo en el `client_state` (base64 que
--    Telnyx devuelve íntegro en cada evento): la pata B lleva dentro el
--    call_control_id de la pata A, que es lo que permite hacer el bridge
--    sin un Map en memoria — un Map se rompe al reiniciar el proceso o con
--    más de una instancia.
--
--    Pero el client_state es de una sola dirección: la pata A se contesta
--    ANTES de que exista la pata B, así que su client_state no puede
--    nombrarla. Cuando quien llama cuelga mientras el navegador todavía
--    está sonando —el caso que deja la pata B huérfana y el registro SIP
--    ocupado— hay que poder ir de A a B. Estas dos columnas guardan esa
--    dirección de forma duradera, como propone §7 del plan de
--    consolidación. Sobreviven a reinicios y a varias instancias.
--
-- Aditiva y idempotente — ninguna columna existente cambia de tipo ni de
-- nombre, y correrla dos veces no rompe nada.
-- ============================================================

-- ============================================================
-- 1. telnyx_config — conexión de credenciales + SIP del agente
-- ============================================================
ALTER TABLE telnyx_config
  ADD COLUMN IF NOT EXISTS credential_connection_id text,
  ADD COLUMN IF NOT EXISTS agent_sip_uri text;

COMMENT ON COLUMN telnyx_config.credential_connection_id IS
  'connection_id de la Credential Connection (WebRTC). Es el que va en POST /v2/calls al crear la pata B; usar el de la Call Control App devuelve 486 user_busy.';
COMMENT ON COLUMN telnyx_config.agent_sip_uri IS
  'Destino SIP del softphone, p.ej. sip:gencred-xxxx@sip.telnyx.com.';

-- El webhook resuelve la cuenta por connection_id. Los eventos de la pata B
-- llegan con el id de la conexión de credenciales, no con el de la CCA, así
-- que ese lookup necesita su propio índice.
CREATE INDEX IF NOT EXISTS idx_telnyx_config_credential_connection
  ON telnyx_config (credential_connection_id);

-- ============================================================
-- 2. calls — rol de la pata y su pareja
-- ============================================================
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS leg_role text
    CHECK (leg_role IN ('pstn', 'webrtc')),
  ADD COLUMN IF NOT EXISTS bridge_peer_control_id text;

COMMENT ON COLUMN calls.leg_role IS
  'pstn = pata A (quien llama, entra por la Call Control App); webrtc = pata B (la que se crea hacia el softphone).';
COMMENT ON COLUMN calls.bridge_peer_control_id IS
  'telnyx_call_control_id de la otra pata del puente. Permite colgar la pata huérfana cuando una de las dos cuelga antes del bridge.';

CREATE INDEX IF NOT EXISTS idx_calls_bridge_peer
  ON calls (bridge_peer_control_id)
  WHERE bridge_peer_control_id IS NOT NULL;
