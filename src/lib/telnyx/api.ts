import { supabaseAdmin } from "@/lib/telnyx/admin-client"
import { decrypt } from "@/lib/whatsapp/encryption"

// Cliente REST de Telnyx (Fase 1) con la API key desencriptada.
// Endpoints verificados en context7 (developers.telnyx.com):
//   - POST /v2/calls     → dial saliente
//   - POST /v2/messages  → envío de SMS
//   - GET  /v2/phone_numbers → validación de key / lista de números

const TELNYX_API_BASE = "https://api.telnyx.com/v2"

export class TelnyxApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "TelnyxApiError"
  }
}

export interface DialInput {
  /** E.164 destino, o un SIP URI (`sip:usuario@sip.telnyx.com`) para la pata B */
  to: string
  /** E.164 origen (default_from_number) */
  from: string
  /**
   * connection_id. Para el saliente normal es el de la Call Control App;
   * para la pata B hacia el softphone TIENE que ser el de la conexión de
   * credenciales (ver migración 057).
   */
  connectionId: string
  webhookUrl?: string
  /** Nombre a mostrar en el softphone (quién llama de verdad). */
  fromDisplayName?: string
  /** base64 que Telnyx devuelve íntegro en cada evento de esta pata. */
  clientState?: string
  /** Segundos antes de que Telnyx cancele la pata si nadie contesta. */
  timeoutSecs?: number
}

export interface DialResult {
  callControlId: string
  callLegId: string
  callSessionId: string
}

export interface SendSmsInput {
  from: string
  to: string
  text: string
  messagingProfileId: string
  webhookUrl?: string
}

export interface PhoneNumber {
  id: string
  phone_number: string
  line_type?: string | null
}

export interface NumberLookupResult {
  phone_number: string
  national_format?: string | null
  country_code?: string | null
  carrier?: { name?: string | null } | string | null
  line_type?: string | null
}

export interface ReputationResult {
  phone_number?: string | null
  spam_risk?: string | null
  spam_category?: string | null
  maturity_score?: number | null
  connection_score?: number | null
  engagement_score?: number | null
}

/**
 * Score 0-100 defensivo desde reputation_data + spam_risk.
 * Compartido entre /numbers/check y /numbers/buy para que el gate de
 * compra (DAD §3: score < 60 → bloquea) NUNCA diverja entre rutas.
 * - spam_risk 'high' → 20 (fuerza bloqueo).
 * - Sin reputation_data o sin scores → null (no bloquea; falta monitoreo).
 */
export function reputationScore(r: ReputationResult | null): number | null {
  if (!r) return null
  if (r.spam_risk === 'high') return 20
  const scores = [r.maturity_score, r.connection_score, r.engagement_score].filter(
    (s): s is number => typeof s === 'number',
  )
  if (scores.length === 0) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export interface NumberOrderInput {
  phoneNumber: string
  connectionId?: string
  messagingProfileId?: string
  billingGroupId?: string
  customerReference?: string
}

export interface NumberOrderResult {
  id?: string | null
  status?: string | null
  phoneNumbersCount?: number | null
}

export interface TelephonyCredential {
  id: string
  sip_username?: string | null
  sip_password?: string | null
}

export interface TelnyxClient {
  dial(input: DialInput): Promise<DialResult>
  /** POST /v2/calls/{id}/actions/answer — contesta la pata entrante. */
  answerCall(callControlId: string, clientState?: string): Promise<void>
  /** POST /v2/calls/{id}/actions/bridge — une esta pata con `otherCallControlId`. */
  bridgeCalls(callControlId: string, otherCallControlId: string): Promise<void>
  /** POST /v2/calls/{id}/actions/hangup — cuelga la pata. */
  hangupCall(callControlId: string): Promise<void>
  sendSms(input: SendSmsInput): Promise<{ id: string }>
  listPhoneNumbers(): Promise<PhoneNumber[]>
  /** GET /v2/number_lookup/{number} — carrier/line_type de un número. */
  lookupNumber(number: string): Promise<NumberLookupResult | null>
  /** GET /v2/reputation/phone_numbers/{number} — spam_risk + scores (0-100). */
  getReputation(number: string): Promise<ReputationResult | null>
  /** POST /v2/number_orders — compra un número (requiere config de cuenta). */
  createNumberOrder(input: NumberOrderInput): Promise<NumberOrderResult>
  /** Crea una Telephony Credential para una conexión SIP (WebRTC). */
  createTelephonyCredential(input: { connectionId: string; name: string }): Promise<TelephonyCredential>
  /** GET /v2/telephony_credentials/{id} — sip_username/sip_password. */
  getTelephonyCredential(credentialId: string): Promise<TelephonyCredential>
  /** POST /v2/telephony_credentials/{id}/token — JWT login_token (24h). */
  createWebrtcToken(credentialId: string): Promise<{ token: string }>
}

export function createTelnyxClient(apiKey: string): TelnyxClient {
  /** Devuelve el JSON completo (data + meta) para poder paginar. */
  async function requestRaw<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${TELNYX_API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new TelnyxApiError(
        `Telnyx ${path} → ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
        res.status,
      )
    }

    return (await res.json()) as T
  }

  async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const json = await requestRaw<{ data: T }>(path, init)
    return json.data as T
  }

  return {
    async dial({
      to,
      from,
      connectionId,
      webhookUrl,
      fromDisplayName,
      clientState,
      timeoutSecs,
    }) {
      // La respuesta de Telnyx usa snake_case; aquí ya se mapea a camelCase.
      type Raw = {
        call_control_id: string
        call_leg_id: string
        call_session_id: string
      }
      const data = await request<Raw>("/calls", {
        method: "POST",
        body: JSON.stringify({
          to,
          from,
          connection_id: connectionId,
          ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
          ...(fromDisplayName ? { from_display_name: fromDisplayName } : {}),
          ...(clientState ? { client_state: clientState } : {}),
          ...(timeoutSecs ? { timeout_secs: timeoutSecs } : {}),
        }),
      })
      return {
        callControlId: data.call_control_id,
        callLegId: data.call_leg_id,
        callSessionId: data.call_session_id,
      }
    },

    // ---- Call control sobre una pata ya existente -------------------
    // Las tres devuelven `{ data: { result: 'ok' } }`; no hay nada que
    // mapear, así que se ignora el cuerpo y solo importa que no lance.

    async answerCall(callControlId, clientState) {
      await request(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
        method: "POST",
        body: JSON.stringify(clientState ? { client_state: clientState } : {}),
      })
    },

    async bridgeCalls(callControlId, otherCallControlId) {
      await request(`/calls/${encodeURIComponent(callControlId)}/actions/bridge`, {
        method: "POST",
        body: JSON.stringify({ call_control_id: otherCallControlId }),
      })
    },

    async hangupCall(callControlId) {
      await request(`/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    },

    async sendSms({ from, to, text, messagingProfileId, webhookUrl }) {
      const data = await request<{ id: string }>("/messages", {
        method: "POST",
        body: JSON.stringify({
          from,
          to,
          text,
          messaging_profile_id: messagingProfileId,
          ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
        }),
      })
      return { id: data.id }
    },

    async listPhoneNumbers() {
      // Paginación real de Telnyx: GET /v2/phone_numbers acepta query
      // params page[number]/page[size], y el response meta es
      // { total_pages, total_results, page_number, page_size } — NO hay
      // campo meta.next (verificado en developers.telnyx.com). Antes se
      // leía json.meta?.next (siempre null) → solo se traía la página 1.
      const all: PhoneNumber[] = []
      const PAGE_SIZE = 100
      let page = 1
      let totalPages: number | null = null
      // Límite defensivo: nunca más de 3 requests (300 números).
      const MAX_PAGES = 3
      while (page <= (totalPages ?? MAX_PAGES) && page <= MAX_PAGES) {
        const json = await requestRaw<{
          data?: PhoneNumber[] | null
          meta?: {
            total_pages?: number | null
            page_number?: number | null
          } | null
        }>(`/phone_numbers?page[size]=${PAGE_SIZE}&page[number]=${page}`)
        all.push(...(json.data ?? []))
        totalPages = json.meta?.total_pages ?? null
        page += 1
      }
      return all
    },

    async lookupNumber(number) {
      // El '+' del E.164 debe URL-encoded (%2B) en el path (doc oficial).
      const data = await request<NumberLookupResult | null>(
        `/number_lookup/${encodeURIComponent(number)}`,
      ).catch((err: TelnyxApiError) => {
        // 4xx de lookup (número no rutiable / sin datos) → null, no rompe el check.
        if (err.status && err.status >= 400 && err.status < 500) return null
        throw err
      })
      return data
    },

    async getReputation(number) {
      // GET /v2/reputation/phone_numbers/{number}; el '+' debe ir como %2B.
      const data = await request<{ reputation_data?: ReputationResult | null } | null>(
        `/reputation/phone_numbers/${encodeURIComponent(number)}`,
      ).catch((err: TelnyxApiError) => {
        // Sin registro de reputación (404) → null; el check no debe romper.
        if (err.status && err.status >= 400 && err.status < 500) return null
        throw err
      })
      if (!data) return null
      return data.reputation_data ?? null
    },

    async createNumberOrder({ phoneNumber, connectionId, messagingProfileId, billingGroupId, customerReference }) {
      const body: Record<string, unknown> = {
        phone_numbers: [{ phone_number: phoneNumber }],
      }
      if (connectionId) body.connection_id = connectionId
      if (messagingProfileId) body.messaging_profile_id = messagingProfileId
      if (billingGroupId) body.billing_group_id = billingGroupId
      if (customerReference) body.customer_reference = customerReference

      // La respuesta usa snake_case; se mapea a camelCase (mismo patrón que dial).
      type Raw = {
        id?: string | null
        status?: string | null
        phone_numbers_count?: number | null
      }
      const data = await request<Raw>("/number_orders", {
        method: "POST",
        body: JSON.stringify(body),
      })
      return {
        id: data.id ?? null,
        status: data.status ?? null,
        phoneNumbersCount: data.phone_numbers_count ?? null,
      }
    },

    async createTelephonyCredential({ connectionId, name }) {
      type Raw = { id: string; sip_username?: string | null; sip_password?: string | null }
      const data = await request<Raw>("/telephony_credentials", {
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId, name }),
      })
      return { id: data.id, sip_username: data.sip_username, sip_password: data.sip_password }
    },

    async getTelephonyCredential(credentialId) {
      type Raw = { id: string; sip_username?: string | null; sip_password?: string | null }
      const data = await request<Raw>(`/telephony_credentials/${credentialId}`)
      return { id: data.id, sip_username: data.sip_username, sip_password: data.sip_password }
    },

    async createWebrtcToken(credentialId) {
      // Verificado context7: POST /v2/telephony_credentials/{id}/token → { data: { token } }
      const data = await request<{ token: string }>(`/telephony_credentials/${credentialId}/token`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      return { token: data.token }
    },
  }
}

/**
 * Carga y desencripta la API key de Telnyx del account (tabla
 * `telnyx_config`, migración 038). Se lee con el cliente service-role
 * (RLS-bypass) porque las rutas server-side no tienen sesión de
 * `auth.uid()` que satisfaga la policy owner-only.
 */
export async function loadTelnyxApiKey(accountId: string): Promise<string> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select("api_key_encrypted")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data?.api_key_encrypted) {
    throw new TelnyxApiError("Telnyx config not found for account")
  }
  return decrypt(data.api_key_encrypted)
}

export interface TelnyxSendConfig {
  /** API key desencriptada. */
  apiKey: string
  /** `default_from_number` (E.164) — origen del SMS. */
  fromNumber: string
  /** Messaging Profile id de Telnyx (migración 043). */
  messagingProfileId: string | null
}

/**
 * Config de envío SMS (send_sms step): API key desencriptada + número
 * origen + messaging profile. Todo desde `telnyx_config`, service-role.
 */
export async function loadTelnyxSendConfig(accountId: string): Promise<TelnyxSendConfig> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select("api_key_encrypted, default_from_number, messaging_profile_id")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data) {
    throw new TelnyxApiError("Telnyx config not found for account")
  }
  return {
    apiKey: decrypt(data.api_key_encrypted),
    fromNumber: data.default_from_number,
    messagingProfileId: data.messaging_profile_id ?? null,
  }
}

export interface TelnyxDialConfig {
  apiKey: string
  /** Call Control App id (connection_id para POST /v2/calls). */
  connectionId: string
  /** `default_from_number` (E.164) — caller id de la llamada saliente. */
  fromNumber: string
}

/**
 * Config de marcado saliente (POST /api/telnyx/call): API key + Call
 * Control App id + número origen. Desde `telnyx_config`, service-role.
 */
export async function loadTelnyxDialConfig(accountId: string): Promise<TelnyxDialConfig> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select("api_key_encrypted, call_control_app_id, default_from_number")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data) {
    throw new TelnyxApiError("Telnyx config not found for account")
  }
  return {
    apiKey: decrypt(data.api_key_encrypted),
    connectionId: data.call_control_app_id ?? "",
    fromNumber: data.default_from_number,
  }
}

export interface TelnyxInboundConfig {
  apiKey: string
  /** Conexión de credenciales — el connection_id de la pata B. */
  credentialConnectionId: string | null
  /** `sip:usuario@sip.telnyx.com` del softphone. */
  agentSipUri: string | null
}

/**
 * Config del puente entrante (webhook): API key + los dos identificadores
 * de la migración 057. Devuelve nulos cuando la cuenta todavía no tiene el
 * entrante configurado — el webhook lo interpreta como "solo contabilidad"
 * y no intenta contestar ni crear la pata B.
 */
export async function loadTelnyxInboundConfig(
  accountId: string,
): Promise<TelnyxInboundConfig | null> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select("api_key_encrypted, credential_connection_id, agent_sip_uri")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data?.api_key_encrypted) return null
  return {
    apiKey: decrypt(data.api_key_encrypted),
    credentialConnectionId: data.credential_connection_id ?? null,
    agentSipUri: data.agent_sip_uri ?? null,
  }
}

/**
 * Asegura que el account tenga una Telephony Credential para el
 * softphone WebRTC (Fase 2). Si `telnyx_config.telephony_credential_id`
 * no existe, crea una y persiste el id — la próxima llamada la reutiliza.
 *
 * La credencial se cuelga de la CONEXIÓN DE CREDENCIALES cuando existe
 * (migración 057). Colgarla de la Call Control App es justo la causa del
 * `registration_status = "Not Registered"`: una credencial telefónica tiene
 * que apuntar a la conexión de credenciales para que el softphone quede
 * registrado y pueda recibir la pata B. Se mantiene el fallback a la CCA
 * para no romper cuentas que ya la tuvieran creada así.
 *
 * POST /v2/telephony_credentials { connection_id, name }.
 */
export async function ensureWebrtcCredential(accountId: string): Promise<string> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select(
      "api_key_encrypted, call_control_app_id, credential_connection_id, telephony_credential_id",
    )
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data) {
    throw new TelnyxApiError("Telnyx config not found for account")
  }
  if (data.telephony_credential_id) return data.telephony_credential_id

  const parentConnectionId =
    data.credential_connection_id || data.call_control_app_id
  if (!parentConnectionId) {
    throw new TelnyxApiError(
      "No connection configured for account (credential connection or Call Control App)",
    )
  }

  const client = createTelnyxClient(decrypt(data.api_key_encrypted))
  const created = await client.createTelephonyCredential({
    connectionId: parentConnectionId,
    name: `wacrm-${accountId.slice(0, 8)}`,
  })

  await admin
    .from("telnyx_config")
    .update({ telephony_credential_id: created.id })
    .eq("account_id", accountId)

  return created.id
}