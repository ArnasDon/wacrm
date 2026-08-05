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
  /** E.164 destino */
  to: string
  /** E.164 origen (default_from_number) */
  from: string
  /** connection_id de la Call Control App */
  connectionId: string
  webhookUrl?: string
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

export interface TelephonyCredential {
  id: string
  sip_username?: string | null
  sip_password?: string | null
}

export interface TelnyxClient {
  dial(input: DialInput): Promise<DialResult>
  sendSms(input: SendSmsInput): Promise<{ id: string }>
  listPhoneNumbers(): Promise<PhoneNumber[]>
  /** Crea una Telephony Credential para una conexión SIP (WebRTC). */
  createTelephonyCredential(input: { connectionId: string; name: string }): Promise<TelephonyCredential>
  /** GET /v2/telephony_credentials/{id} — sip_username/sip_password. */
  getTelephonyCredential(credentialId: string): Promise<TelephonyCredential>
  /** POST /v2/telephony_credentials/{id}/token — JWT login_token (24h). */
  createWebrtcToken(credentialId: string): Promise<{ token: string }>
}

export function createTelnyxClient(apiKey: string): TelnyxClient {
  async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
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

    const json = (await res.json()) as { data: T }
    return json.data as T
  }

  return {
    async dial({ to, from, connectionId, webhookUrl }) {
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
        }),
      })
      return {
        callControlId: data.call_control_id,
        callLegId: data.call_leg_id,
        callSessionId: data.call_session_id,
      }
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
      const data = await request<PhoneNumber[]>("/phone_numbers")
      return data
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

/**
 * Asegura que el account tenga una Telephony Credential para el
 * softphone WebRTC (Fase 2). Si `telnyx_config.telephony_credential_id`
 * no existe, crea una asociada a la Call Control App (migración 044) y
 * persiste el id — la próxima llamada la reutiliza. Devuelve el id.
 *
 * Verificado context7: POST /v2/telephony_credentials { connection_id, name }.
 */
export async function ensureWebrtcCredential(accountId: string): Promise<string> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from("telnyx_config")
    .select("api_key_encrypted, call_control_app_id, telephony_credential_id")
    .eq("account_id", accountId)
    .maybeSingle()

  if (error || !data) {
    throw new TelnyxApiError("Telnyx config not found for account")
  }
  if (data.telephony_credential_id) return data.telephony_credential_id
  if (!data.call_control_app_id) {
    throw new TelnyxApiError("Call Control App not configured for account")
  }

  const client = createTelnyxClient(decrypt(data.api_key_encrypted))
  const created = await client.createTelephonyCredential({
    connectionId: data.call_control_app_id,
    name: `wacrm-${accountId.slice(0, 8)}`,
  })

  await admin
    .from("telnyx_config")
    .update({ telephony_credential_id: created.id })
    .eq("account_id", accountId)

  return created.id
}