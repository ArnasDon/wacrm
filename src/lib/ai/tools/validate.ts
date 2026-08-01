import type { ApiToolParam } from './api'

/** Reserved — filled server-side from the encrypted secret, so a
 *  model-supplied param can never collide with it. */
const RESERVED_PARAM_NAME = 'API_KEY'

const PARAM_NAME_RE = /^[a-zA-Z0-9_]+$/
/** Generous but bounded — a real API integration needs a handful of
 *  params/headers; this just stops a pathological payload from
 *  ballooning the tool's JSON Schema or the request. */
const MAX_ITEMS = 20

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** `http(s)://` only — no `file:`, `ftp:`, etc. Doesn't check
 *  reachability; that's `isDeliverableUrl` at call time (SSRF guard). */
export function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Parse+validate the `api_params` the client sent (raw JSON, not yet
 *  trusted). Enforces unique, identifier-shaped names that don't
 *  collide with the reserved `{API_KEY}` placeholder. */
export function parseApiParams(raw: unknown): ValidationResult<ApiToolParam[]> {
  if (raw === undefined) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'api_params must be an array' }
  if (raw.length > MAX_ITEMS) {
    return { ok: false, error: `api_params: at most ${MAX_ITEMS} parameters` }
  }

  const seen = new Set<string>()
  const params: ApiToolParam[] = []
  for (const entry of raw) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const description = typeof entry?.description === 'string' ? entry.description.trim() : ''
    const required = entry?.required === true

    if (!PARAM_NAME_RE.test(name)) {
      return {
        ok: false,
        error: `api_params: "${name || '(vacío)'}" debe usar solo letras, números y "_"`,
      }
    }
    if (name === RESERVED_PARAM_NAME) {
      return { ok: false, error: `api_params: "${RESERVED_PARAM_NAME}" está reservado` }
    }
    if (!description) {
      return { ok: false, error: `api_params: "${name}" necesita una descripción` }
    }
    if (seen.has(name)) {
      return { ok: false, error: `api_params: nombre repetido "${name}"` }
    }
    seen.add(name)
    params.push({ name, description, required })
  }
  return { ok: true, value: params }
}

/** Parse+validate the `api_headers` the client sent — a flat
 *  string-to-string map of static header templates. */
export function parseApiHeaders(raw: unknown): ValidationResult<Record<string, string>> {
  if (raw === undefined) return { ok: true, value: {} }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'api_headers must be an object' }
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_ITEMS) {
    return { ok: false, error: `api_headers: at most ${MAX_ITEMS} headers` }
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of entries) {
    const name = key.trim()
    if (!name) return { ok: false, error: 'api_headers: el nombre del header no puede estar vacío' }
    if (typeof value !== 'string') {
      return { ok: false, error: `api_headers: el valor de "${name}" debe ser texto` }
    }
    headers[name] = value
  }
  return { ok: true, value: headers }
}
