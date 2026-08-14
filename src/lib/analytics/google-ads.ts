// ============================================================
// Google Ads — Data Manager API adapter (offline conversions)
//
// A partir del 15-jun-2026 UploadClickConversions (Google Ads API)
// está deprecada para importar conversiones offline: requiere usar la
// Data Manager API. Este adapter implementa ESA vía (la soportada hoy).
//
//   POST https://datamanager.googleapis.com/v1/events:ingest
//   scope OAuth: https://www.googleapis.com/auth/datamanager
//
// Body (verificado en developers.google.com/data-manager/api):
//   {
//     "destinations": [{ operatingAccount, loginAccount,
//                        productDestinationId }],
//     "events": [{ eventTimestamp, eventSource, transactionId,
//                  conversionValue, currency, adIdentifiers,
//                  userData }],
//     "encoding": "HEX"
//   }
//
// - `productDestinationId` es el ID de la conversion action de Google
//   Ads con type UPLOAD_CLICKS (fuente "Website (Import from clicks)").
// - `eventSource` = WEB (la interacción con el anuncio fue web).
// - `transactionId` dedupica contra el tag del navegador (y entre
//   reintentos). Usamos nuestro event_id determinístico.
// - `adIdentifiers.{gclid|gbraid|wbraid}`: EXACTAMENTE uno (o ninguno,
//   si la atribución no trae clid — Google intentará emparejar por
//   userData).
// - `userData.userIdentifiers[{emailAddress|phoneNumber}]` hasheados
//   con SHA-256 hex (encoding HEX), normalizados (email minúsculas,
//   teléfono E.164).
//
// Sin credenciales → no-op con log (fail-open): el cron nunca rompe.
// Credenciales por env (opción A aprobada):
//   GOOGLE_ADS_CUSTOMER_ID         — cuenta Google Ads (sin guiones)
//   GOOGLE_ADS_CONVERSION_ACTION_ID — la conversion action UPLOAD_CLICKS
//   GOOGLE_ADS_OAUTH_TOKEN          — token OAuth2 con scope datamanager
// ============================================================

const DM_ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest'

export interface GoogleAdsCreds {
  customerId: string
  conversionActionId: string
  oauthToken: string
}

export interface GoogleOfflineConversionInput {
  event_name:
    | 'lead'
    | 'qualified_lead'
    | 'appointment_booked'
    | 'appointment_showed'
    | 'deal_won'
    | 'purchase'
  event_id: string
  event_time: number // epoch ms
  value?: number
  currency?: string
  click_ids: { gclid?: string; gbraid?: string; wbraid?: string }
  user_data?: { email?: string; phone?: string }
}

/** Lee las credenciales de Google Ads del entorno. null si no están. */
export function loadGoogleAdsCreds(): GoogleAdsCreds | null {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID
  const oauthToken = process.env.GOOGLE_ADS_OAUTH_TOKEN
  if (!customerId || !conversionActionId || !oauthToken) return null
  return { customerId, conversionActionId, oauthToken }
}

/** Normaliza un email para hashing: minúsculas y sin espacios. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Normaliza un teléfono a E.164: solo dígitos y el prefijo '+'. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : `+${digits}`
}

/** SHA-256 en hex (mayúsculas), como exige Google en encoding HEX. */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Compone userData con email/phone hasheados (encrypted=no, hashed=sí). */
export async function buildGoogleUserData(user?: {
  email?: string
  phone?: string
}): Promise<{ userIdentifiers: Array<{ emailAddress?: string; phoneNumber?: string }> } | undefined> {
  if (!user || (!user.email && !user.phone)) return undefined
  const identifiers: Array<{ emailAddress?: string; phoneNumber?: string }> = []
  if (user.email) {
    identifiers.push({ emailAddress: await sha256Hex(normalizeEmail(user.email)) })
  }
  if (user.phone) {
    identifiers.push({ phoneNumber: await sha256Hex(normalizePhone(user.phone)) })
  }
  return { userIdentifiers: identifiers }
}

/** Un solo clid del conjunto (gclid > gbraid > wbraid), como espera Google. */
export function pickClickId(click_ids: { gclid?: string; gbraid?: string; wbraid?: string }): {
  gclid?: string
  gbraid?: string
  wbraid?: string
} {
  if (click_ids.gclid) return { gclid: click_ids.gclid }
  if (click_ids.gbraid) return { gbraid: click_ids.gbraid }
  if (click_ids.wbraid) return { wbraid: click_ids.wbraid }
  return {}
}

/**
 * Envía una conversión offline a Google Ads vía Data Manager API.
 * Idempotente por `transactionId` = event_id (dedup con tag y retries).
 * Nunca lanza; devuelve { ok } o { ok: false, reason }.
 */
export async function sendOfflineConversion(
  input: GoogleOfflineConversionInput,
  creds: GoogleAdsCreds,
): Promise<{ ok: boolean; reason?: string }> {
  const userData = await buildGoogleUserData(input.user_data)
  const body = {
    destinations: [
      {
        operatingAccount: {
          accountType: 'GOOGLE_ADS',
          accountId: creds.customerId,
        },
        loginAccount: {
          accountType: 'GOOGLE_ADS',
          accountId: creds.customerId,
        },
        productDestinationId: creds.conversionActionId,
      },
    ],
    events: [
      {
        eventTimestamp: new Date(input.event_time).toISOString(),
        eventSource: 'WEB',
        transactionId: input.event_id,
        ...(input.value !== undefined && input.currency
          ? { conversionValue: input.value, currency: input.currency }
          : {}),
        adIdentifiers: pickClickId(input.click_ids),
        ...(userData ? { userData } : {}),
      },
    ],
    encoding: 'HEX',
  }

  try {
    const res = await fetch(DM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.oauthToken}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { ok: false, reason: `HTTP ${res.status}: ${err.slice(0, 400)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'fetch failed' }
  }
}