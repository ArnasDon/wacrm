// ============================================================
// Meta Conversions API — dispatchConversion (Item 16, DAD §8.1/§8.3)
//
// Cierra el ciclo CTWA: cuando un lead llega por un anuncio Click-to-
// WhatsApp, el webhook captura `referral.ctwa_clid` y este módulo lo
// reporta a la CAPI para que Meta optimice contra el evento real.
//
// Endpoint y body verificados en context7 (developers.facebook.com):
//   POST /<API_VERSION>/<DATASET_ID>/events
//   { event_name, event_time, action_source: "business_messaging",
//     messaging_channel: "whatsapp", user_data: { ctwa_clid },
//     messaging_outcome_data: { outcome_type: "automatic_events" } }
//
// Credenciales por env (multi-account: futura tabla analytics_config):
//   META_CAPI_DATASET_ID   — ID del dataset (Pixel) de Meta
//   META_CAPI_ACCESS_TOKEN — token de acceso con permiso de reporting
// Sin credenciales → no-op con log (fail-open: nunca rompe el webhook).
// ============================================================

const GRAPH_VERSION = 'v21.0'

export interface ConversionEventInput {
  event_name: 'LeadSubmitted' | 'Purchase'
  event_time: number
  ctwa_clid: string
  currency?: string
  value?: number
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
