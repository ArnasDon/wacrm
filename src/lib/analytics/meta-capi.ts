// ============================================================
// Meta Conversions API — dispatchConversion (Item 16, DAD §8.1/§8.3)
//
// Dos vías:
//
//   CTWA (loop Click-to-WhatsApp): cuando un lead llega por un anuncio
//     CTWA, el webhook captura `referral.ctwa_clid` y se reporta con
//     action_source business_messaging para que Meta optimice.
//
//   WEBSITE (loop de conversiones del core): cada evento de negocio
//     del catálogo canónico (lead, qualified_lead, appointment_booked,
//     appointment_showed, deal_won, purchase) se reporta con
//     action_source website, `event_id` (dedup browser+server, pilar
//     del prompt de conversiones), `user_data` con em/ph hasheados y
//     fbc/fbp para emparejar el navegador, y custom_data con el valor.
//
// Endpoint y body verificados en context7 (developers.facebook.com):
//   POST /<API_VERSION>/<DATASET_ID>/events
//
// Credenciales por env (multi-account: futura tabla analytics_config):
//   META_CAPI_DATASET_ID   — ID del dataset (Pixel) de Meta
//   META_CAPI_ACCESS_TOKEN — token de acceso con permiso de reporting
// Sin credenciales → no-op con log (fail-open: nunca rompe el webhook).
// ============================================================

const GRAPH_VERSION = 'v21.0'

/** Evento CTWA (Click-to-WhatsApp) — action_source business_messaging. */
export interface ConversionEventInput {
  event_name: 'LeadSubmitted' | 'Purchase'
  event_time: number
  ctwa_clid: string
  currency?: string
  value?: number
}

/** Evento website del loop de conversiones del core. */
export interface WebsiteConversionEventInput {
  event_name:
    | 'Lead'
    | 'QualifiedLead'
    | 'AppointmentBooked'
    | 'AppointmentShowed'
    | 'Purchase' // deal_won == purchase
  event_id: string
  event_time: number
  value?: number
  currency?: string
  fbc?: string
  fbp?: string
  user_data?: { email?: string; phone?: string }
  event_source_url?: string
}

export interface UserDataToHash {
  email?: string
  phone?: string
}

/** Normaliza email para hashing: minúsculas y sin espacios. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Normaliza teléfono: quita todo excepto dígitos (y '+' si lo lleva). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : `+${digits}`
}

/** SHA-256 en hex minúsculas (Meta CAPI usa lowercase hex). */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compone user_data con em/ph hasheados (Meta espera lowercase hex). */
export async function buildMetaUserData(
  user?: UserDataToHash,
): Promise<Record<string, string> | undefined> {
  if (!user || (!user.email && !user.phone)) return undefined
  const out: Record<string, string> = {}
  if (user.email) out.em = await sha256Hex(normalizeEmail(user.email))
  if (user.phone) out.ph = await sha256Hex(normalizePhone(user.phone))
  return out
}

export interface CapiCreds {
  datasetId: string
  accessToken: string
}

/** Lee las credenciales CAPI del entorno. null si no están configuradas. */
export function loadCapiCreds(): CapiCreds | null {
  const datasetId = process.env.META_CAPI_DATASET_ID
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!datasetId || !accessToken) return null
  return { datasetId, accessToken }
}

/**
 * Reporta un evento a la Meta Conversions API (action_source
 * business_messaging, channel whatsapp). Idempotente por construcción:
 * el caller decide el event_name y el clid; Meta dedupica por
 * (event_name, event_time, user_data).
 *
 * Devuelve { ok } o { ok: false, reason } — nunca lanza, para que el
 * webhook de WhatsApp no se caiga por un fallo de reporting.
 */
export async function dispatchConversion(input: ConversionEventInput, creds: CapiCreds): Promise<{ ok: boolean; reason?: string }> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${creds.datasetId}/events`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify({
        data: [
          {
            event_name: input.event_name,
            event_time: input.event_time,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {
              ctwa_clid: input.ctwa_clid,
            },
            ...(input.event_name === 'Purchase' && input.currency && input.value !== undefined
              ? { custom_data: { currency: input.currency, value: input.value } }
              : {}),
            messaging_outcome_data: {
              outcome_type: 'automatic_events',
            },
          },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'fetch failed' }
  }
}

/**
 * Reporta un evento de negocio del loop de conversiones a la CAPI con
 * action_source website. Idempotente por `event_id` (pilar del prompt:
 * el mismo event_id en navegador y servidor → Meta dedupica).
 *
 * user_data em/ph se hashean (SHA-256 lowercase hex) antes de enviar.
 * fbc/fbp se pasan tal cual si vienen capturados.
 * Devuelve { ok } o { ok: false, reason } — nunca lanza.
 */
export async function dispatchWebsiteConversion(
  input: WebsiteConversionEventInput,
  creds: CapiCreds,
): Promise<{ ok: boolean; reason?: string }> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${creds.datasetId}/events`
  const userData = await buildMetaUserData(input.user_data)
  // Combina user_data (em/ph hasheados) con fbc/fbp en UN solo objeto:
  // varios spreads de la clave user_data se pisarían entre sí.
  const combinedUserData = {
    ...(userData ?? {}),
    ...(input.fbc ? { fbc: input.fbc } : {}),
    ...(input.fbp ? { fbp: input.fbp } : {}),
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify({
        data: [
          {
            event_name: input.event_name,
            event_time: Math.floor(input.event_time / 1000),
            event_id: input.event_id,
            action_source: 'website',
            ...(Object.keys(combinedUserData).length
              ? { user_data: combinedUserData }
              : {}),
            ...(input.event_source_url
              ? { event_source_url: input.event_source_url }
              : {}),
            ...(input.event_name === 'Purchase' &&
            input.value !== undefined &&
            input.currency
              ? { custom_data: { currency: input.currency, value: input.value } }
              : {}),
          },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'fetch failed' }
  }
}
