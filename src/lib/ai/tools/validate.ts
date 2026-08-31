import type { ToolParameter } from './types'

// ------------------------------------------------------------
// Pre-save validation for an AI tool config. Mirrors the
// `{path, message}` issue shape and style of
// `src/lib/automations/validate.ts` (`send_webhook`'s URL check in
// particular), so it reads the same way to anyone who already knows
// that file.
// ------------------------------------------------------------

export interface ToolValidationIssue {
  path: string
  message: string
}

interface ToolConfigLike {
  name?: unknown
  description?: unknown
  method?: unknown
  url?: unknown
  auth_type?: unknown
  auth_header_name?: unknown
  auth_secret?: unknown
  parameters?: unknown
}

const NAME_RE = /^[a-z0-9_]{1,64}$/
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const AUTH_TYPES = ['none', 'bearer', 'api_key', 'basic']
const PARAM_LOCATIONS = ['query', 'body', 'path', 'header']
const PARAM_TYPES = ['string', 'number', 'boolean']
const MAX_PARAMETERS = 20

/**
 * `requireSecret`: true when the row needs a usable credential and
 * doesn't already have one saved — i.e. on create with a non-`none`
 * auth type, or on edit when auth_type just changed to non-`none` and
 * no secret (existing or newly typed) is available. The route computes
 * this; this function just enforces it.
 */
export function validateToolConfig(
  cfg: ToolConfigLike,
  opts: { requireSecret: boolean },
): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = []

  if (!nonEmpty(cfg.name) || !NAME_RE.test(String(cfg.name))) {
    issues.push({
      path: 'name',
      message: 'name must be lowercase letters, numbers, and underscores only (max 64 chars)',
    })
  }
  if (!nonEmpty(cfg.description)) {
    issues.push({
      path: 'description',
      message: 'description is required — it tells the agent when to use this tool',
    })
  }
  if (!METHODS.includes(String(cfg.method))) {
    issues.push({ path: 'method', message: 'method must be GET, POST, PUT, PATCH, or DELETE' })
  }
  if (!nonEmpty(cfg.url)) {
    issues.push({ path: 'url', message: 'URL is required' })
  } else {
    try {
      const u = new URL(String(cfg.url))
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        issues.push({ path: 'url', message: 'URL must use http or https' })
      }
    } catch {
      issues.push({ path: 'url', message: 'URL is not valid' })
    }
  }

  const authType = String(cfg.auth_type ?? 'none')
  if (!AUTH_TYPES.includes(authType)) {
    issues.push({ path: 'auth_type', message: 'unknown auth type' })
  } else if (authType !== 'none') {
    if (opts.requireSecret && !nonEmpty(cfg.auth_secret)) {
      issues.push({ path: 'auth_secret', message: 'a credential is required for this auth type' })
    }
    if (authType === 'api_key' && !nonEmpty(cfg.auth_header_name)) {
      issues.push({
        path: 'auth_header_name',
        message: 'header name is required for API key auth',
      })
    }
  }

  const params = Array.isArray(cfg.parameters) ? (cfg.parameters as ToolParameter[]) : []
  if (params.length > MAX_PARAMETERS) {
    issues.push({
      path: 'parameters',
      message: `a tool may declare at most ${MAX_PARAMETERS} parameters`,
    })
  }
  const seen = new Set<string>()
  params.forEach((p, i) => {
    const path = `parameters[${i}]`
    if (!nonEmpty(p?.name)) {
      issues.push({ path: `${path}.name`, message: 'parameter name is required' })
    } else if (seen.has(p.name)) {
      issues.push({ path: `${path}.name`, message: `duplicate parameter name "${p.name}"` })
    } else {
      seen.add(p.name)
    }
    if (!PARAM_LOCATIONS.includes(String(p?.in))) {
      issues.push({ path: `${path}.in`, message: 'location must be query, body, path, or header' })
    }
    if (!PARAM_TYPES.includes(String(p?.type))) {
      issues.push({ path: `${path}.type`, message: 'type must be string, number, or boolean' })
    }
  })

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
