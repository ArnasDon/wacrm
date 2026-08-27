/**
 * Budun ERP Catalog API client.
 *
 * Calqued on `src/lib/whatsapp/meta-api.ts`: named-args (no positional
 * args to swap by mistake), a typed error helper that tries to read the
 * upstream's own error message, `fetch` + `AbortSignal.timeout` for the
 * per-call timeout (same mechanism as `src/lib/ai/providers/anthropic.ts`
 * — no retry/backoff library is introduced, matching the rest of the
 * codebase).
 *
 * Endpoint contract per
 * docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
 * §1/§5: the COMMERCIAL Catalog API lives under `/api/v1/catalog/` —
 * never the administrative Inventory API (`/api/v1/`). `base_url` is
 * the account's configured ERP root; this module owns the `/api/v1/
 * catalog/...` suffix, matching 01_MASTER_EXECUTION.md ("Usar Catalog
 * API bajo: /api/v1/catalog/").
 *
 * IMPORTANT — unconfirmed wire details: the spec explicitly says
 * "Antes de hardcodear, verificar las rutas reales en el
 * repositorio/documentación del ERP" (§5) and does not give exact query
 * parameter names for availability/media. The paths and param names
 * below (`q`, `color`, `product_id`) are the spec's best-effort
 * contract, not a confirmed wire format — flagged in the implementation
 * report. Getting a live 404/422 back from a real Budun instance is
 * expected to require a small param-name adjustment here, isolated to
 * this one file.
 */

const CATALOG_PATH = '/api/v1/catalog'

export interface BudunClientArgs {
  baseUrl: string
  /** Bearer secret — the Application Secret / Catalog API access
   *  credential. Never logged, never echoed in error messages. */
  secret: string
  /** Public, non-secret integration identifier. Sent alongside the
   *  Bearer secret when the ERP wants to disambiguate integrations. */
  appKey?: string | null
  timeoutMs?: number
}

export class BudunApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'BudunApiError'
    this.code = opts.code ?? 'budun_api_error'
    this.status = opts.status ?? 502
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

export interface BudunProductPayload {
  id: string
  name?: unknown
  brand?: unknown
  model?: unknown
  sku?: unknown
  description?: unknown
  variants?: unknown
  colors?: unknown
  capacity?: unknown
  size?: unknown
  price?: unknown
  currency?: unknown
  available?: unknown
  available_quantity?: unknown
  primary_image?: unknown
  images?: unknown
}

interface BudunErrorEnvelope {
  error?: { message?: string; code?: string } | string
  detail?: string
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | undefined>): string {
  const root = baseUrl.replace(/\/+$/, '')
  const url = new URL(`${root}${CATALOG_PATH}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

async function toApiError(res: Response): Promise<BudunApiError> {
  let detail = ''
  try {
    const body = (await res.json()) as BudunErrorEnvelope
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.detail ?? '')
  } catch {
    // non-JSON body — fall back to the status line below
  }
  const code =
    res.status === 401 || res.status === 403
      ? 'invalid_credentials'
      : res.status === 404
        ? 'not_found'
        : res.status === 429
          ? 'rate_limited'
          : 'provider_error'
  const base =
    code === 'invalid_credentials'
      ? 'Budun ERP rejected the credentials'
      : code === 'not_found'
        ? 'Budun ERP: not found'
        : code === 'rate_limited'
          ? 'Budun ERP rate limit reached'
          : `Budun ERP API error (${res.status})`
  return new BudunApiError(detail ? `${base}: ${detail}` : base, { code, status: res.status })
}

export class BudunClient {
  private readonly baseUrl: string
  private readonly secret: string
  private readonly appKey: string | null
  private readonly timeoutMs: number

  constructor(args: BudunClientArgs) {
    this.baseUrl = args.baseUrl
    this.secret = args.secret
    this.appKey = args.appKey ?? null
    this.timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secret}`,
      Accept: 'application/json',
    }
    if (this.appKey) headers['X-App-Key'] = this.appKey
    return headers
  }

  private async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = buildUrl(this.baseUrl, path, params)
    let res: Response
    try {
      res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new BudunApiError('Budun ERP did not respond in time.', { code: 'timeout', status: 504 })
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new BudunApiError(`Could not reach Budun ERP: ${msg}`, { code: 'network_error', status: 502 })
    }
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  }

  /** GET /api/v1/catalog/search/?q=&color= — search results, filtered
   *  server-side by the ERP; this client never sees more than the
   *  commercial fields the spec authorizes. */
  async search(query: string, color?: string, limit?: number): Promise<BudunProductPayload[]> {
    const data = await this.get<{ products?: BudunProductPayload[] } | BudunProductPayload[]>('/search/', {
      q: query,
      color,
      limit,
    })
    if (Array.isArray(data)) return data
    return data.products ?? []
  }

  /** GET /api/v1/catalog/products/{id}/ */
  async getProduct(id: string): Promise<BudunProductPayload | null> {
    try {
      return await this.get<BudunProductPayload>(`/products/${encodeURIComponent(id)}/`)
    } catch (err) {
      if (err instanceof BudunApiError && err.code === 'not_found') return null
      throw err
    }
  }

  /** GET /api/v1/catalog/availability/?product_id= */
  async getAvailability(productId: string): Promise<{
    available?: unknown
    available_quantity?: unknown
    variants?: { label?: unknown; available_quantity?: unknown; available?: unknown }[]
  } | null> {
    try {
      return await this.get('/availability/', { product_id: productId })
    } catch (err) {
      if (err instanceof BudunApiError && err.code === 'not_found') return null
      throw err
    }
  }

  /**
   * Test the connection: URL + credential + auth + a real (cheap)
   * catalog call, matching the "Probar conexión" checklist in
   * docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
   * §21 (URL, credencial, auth, scope, endpoint, respuesta, latencia,
   * error seguro). Never throws — callers get a structured result so
   * the settings UI can render a specific reason without leaking the
   * secret in the message.
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const startedAt = Date.now()
    try {
      await this.search('', undefined, 1)
      return { ok: true, latencyMs: Date.now() - startedAt, message: 'Conexión exitosa.' }
    } catch (err) {
      const message =
        err instanceof BudunApiError ? err.message : 'No se pudo conectar con el Catalog API de Budun.'
      return { ok: false, latencyMs: Date.now() - startedAt, message }
    }
  }
}
