import { decrypt } from '@/lib/whatsapp/encryption'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

/**
 * "Call an HTTP API" tool — the executable behind an `ai_tools` row of
 * type 'api' (migration 044). Lets the agent connect to any external
 * or internal API (OpenWeatherMap, a currency-exchange API, an
 * internal order-status endpoint, ...) instead of only Google Sheets.
 *
 * The admin configures a URL/header/body template with `{param}`
 * placeholders; the model fills those in as function-call arguments
 * (`api_params` becomes the tool's JSON Schema). A reserved `{API_KEY}`
 * placeholder is filled server-side from the encrypted secret, so the
 * key is never exposed to the model or the account's admins after
 * it's saved.
 */

const FETCH_TIMEOUT_MS = 8_000
/** Same order of magnitude as the Google Sheets tool's cap — enough
 *  for a real API response, small enough to not blow the token budget. */
const MAX_CHARS = 12_000

export interface ApiToolParam {
  name: string
  description: string
  required: boolean
}

export interface ApiToolRow {
  api_url: string
  api_method: string
  api_params: ApiToolParam[]
  api_headers: Record<string, string>
  api_body: string | null
  api_key_encrypted: string | null
}

/** Replace `{key}` in `template` with `values[key]` — leaves unknown
 *  placeholders untouched so a typo'd param name fails loudly (a
 *  literal "{foo}" in the request) instead of silently becoming "". */
function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  )
}

/**
 * Run the tool end-to-end for a given `ai_tools` row — builds the
 * request from the template + model-supplied args, fetches it, and
 * returns the response body (capped) as text for the model to read.
 * Never throws — any failure becomes a readable string returned AS
 * the tool result.
 */
export async function runApiTool(
  tool: ApiToolRow,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const values: Record<string, string> = {}
    for (const p of tool.api_params) {
      const v = args[p.name]
      values[p.name] = v === undefined || v === null ? '' : String(v)
    }
    if (tool.api_key_encrypted) {
      try {
        values.API_KEY = decrypt(tool.api_key_encrypted)
      } catch {
        return 'Error: la clave de la API configurada no se pudo desencriptar. Vuelve a guardarla en la configuración de la herramienta.'
      }
    }

    const url = substitute(tool.api_url, values)

    // SSRF guard — api_url is admin-configured but the fetch happens
    // server-side and is triggered automatically on inbound customer
    // messages, so refuse anything that isn't publicly routable. Same
    // guard used for webhook delivery and the template-header fetch.
    if (!(await isDeliverableUrl(url))) {
      return 'Error: la URL de la API configurada no es accesible públicamente.'
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    for (const [k, v] of Object.entries(tool.api_headers)) {
      headers[k] = substitute(v, values)
    }

    const method = tool.api_method === 'POST' ? 'POST' : 'GET'
    const init: RequestInit = {
      method,
      headers,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, defeating the guard above.
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
    if (method === 'POST' && tool.api_body) {
      init.body = substitute(tool.api_body, values)
      headers['Content-Type'] ??= 'application/json'
    }

    const res = await fetch(url, init)
    const text = await res.text()
    if (!res.ok) {
      return `Error: la API respondió con estado ${res.status}. ${text.slice(0, 500)}`
    }

    // Re-serialize JSON compactly (drops incidental whitespace); leave
    // any other content type as-is.
    let out = text
    try {
      out = JSON.stringify(JSON.parse(text))
    } catch {
      // Not JSON — return the raw body.
    }
    if (out.length > MAX_CHARS) {
      out = `${out.slice(0, MAX_CHARS)}\n\n[Respuesta truncada.]`
    }
    return out
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error al consultar la API: ${message}`
  }
}
