import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { AiTool, ToolExecutionRequest, ToolExecutionResult, ToolParameter } from './types'

/** Bounds token cost when a tool's response re-enters the prompt as a
 *  tool result — mirrors the spirit of `MAX_OUTPUT_TOKENS`. */
const MAX_RESPONSE_CHARS = 8_000
const REDACTED = '••••••••'

/**
 * Build + fire the HTTP request for one tool call, from the model's
 * arguments. Never throws: every failure mode (bad args, SSRF-blocked
 * destination, timeout, non-2xx) becomes `{ok: false, error}` so the
 * agentic loop in `generate.ts` can hand it back to the model as a tool
 * result instead of the whole reply blowing up.
 *
 * Reuses the exact SSRF guard + `redirect: 'manual'` + timeout pattern
 * already used for automations' `send_webhook` step
 * (`src/lib/automations/engine.ts`, `src/lib/webhooks/ssrf.ts`).
 */
export async function executeTool(
  tool: AiTool,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const start = Date.now()

  const coerced = coerceArgs(tool.parameters, args)
  if (!coerced.ok) {
    return errorResult(start, tool, coerced.error)
  }
  const values = coerced.values

  // Path placeholders first, then a URL object so query params can be
  // appended safely (handles existing query strings / encoding).
  let url: URL
  try {
    let rawUrl = tool.url
    for (const p of tool.parameters) {
      if (p.in === 'path') {
        rawUrl = rawUrl.replaceAll(
          `{${p.name}}`,
          encodeURIComponent(String(values[p.name] ?? '')),
        )
      }
    }
    url = new URL(rawUrl)
  } catch {
    return errorResult(start, tool, 'Tool URL is invalid.')
  }
  for (const p of tool.parameters) {
    if (p.in === 'query' && values[p.name] !== undefined) {
      url.searchParams.set(p.name, String(values[p.name]))
    }
  }

  // SSRF guard: the URL is account-controlled and this server makes the
  // request. Reject loopback / private / link-local / metadata hosts.
  if (!(await isDeliverableUrl(url.toString()))) {
    return errorResult(start, tool, 'Tool destination is not allowed.')
  }

  const headers: Record<string, string> = { ...tool.headers }
  const redactedHeaders: Record<string, string> = { ...tool.headers }
  for (const p of tool.parameters) {
    if (p.in === 'header' && values[p.name] !== undefined) {
      headers[p.name] = String(values[p.name])
      redactedHeaders[p.name] = String(values[p.name])
    }
  }
  applyAuth(tool, headers, redactedHeaders)

  const bodyParams = tool.parameters.filter((p) => p.in === 'body')
  let body: Record<string, unknown> | undefined
  if (bodyParams.length > 0 && tool.method !== 'GET') {
    body = Object.fromEntries(
      bodyParams
        .filter((p) => values[p.name] !== undefined)
        .map((p) => [p.name, values[p.name]]),
    )
    headers['Content-Type'] ??= 'application/json'
  }

  const requestLog: ToolExecutionRequest = {
    method: tool.method,
    url: url.toString(),
    headers: redactedHeaders,
    body: body ?? null,
  }

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: tool.method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, defeating the SSRF guard above.
      redirect: 'manual',
      signal: AbortSignal.timeout(tool.timeoutMs),
    })
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? 'Tool call timed out.'
        : err instanceof Error
          ? err.message
          : 'Tool call failed.'
    return {
      ok: false,
      status: null,
      statusText: null,
      body: null,
      durationMs: Date.now() - start,
      error: message,
      request: requestLog,
    }
  }

  const rawText = await res.text().catch(() => '')
  const truncated = rawText.length > MAX_RESPONSE_CHARS
  const responseBody = truncated
    ? `${rawText.slice(0, MAX_RESPONSE_CHARS)}\n…[truncated]`
    : rawText

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    body: responseBody || null,
    durationMs: Date.now() - start,
    error: res.ok ? null : `Tool responded with status ${res.status}`,
    request: requestLog,
  }
}

function applyAuth(
  tool: AiTool,
  headers: Record<string, string>,
  redactedHeaders: Record<string, string>,
): void {
  if (!tool.authSecret) return
  switch (tool.authType) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${tool.authSecret}`
      redactedHeaders['Authorization'] = `Bearer ${REDACTED}`
      break
    case 'api_key': {
      const headerName = tool.authHeaderName || 'X-API-Key'
      headers[headerName] = tool.authSecret
      redactedHeaders[headerName] = REDACTED
      break
    }
    case 'basic':
      headers['Authorization'] = `Basic ${Buffer.from(tool.authSecret).toString('base64')}`
      redactedHeaders['Authorization'] = `Basic ${REDACTED}`
      break
    case 'none':
      break
  }
}

function errorResult(start: number, tool: AiTool, message: string): ToolExecutionResult {
  return {
    ok: false,
    status: null,
    statusText: null,
    body: null,
    durationMs: Date.now() - start,
    error: message,
    request: { method: tool.method, url: tool.url, headers: {}, body: null },
  }
}

/**
 * Validate required params are present and coerce to the declared
 * type. Never throws — a bad-arg failure becomes a typed error the
 * caller turns into a tool result, so the model sees exactly what it
 * got wrong and can retry with corrected arguments.
 */
function coerceArgs(
  parameters: ToolParameter[],
  args: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const values: Record<string, unknown> = {}
  for (const p of parameters) {
    const raw = args[p.name]
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) return { ok: false, error: `Missing required parameter "${p.name}".` }
      continue
    }
    if (p.type === 'number') {
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        return { ok: false, error: `Parameter "${p.name}" must be a number.` }
      }
      values[p.name] = n
    } else if (p.type === 'boolean') {
      values[p.name] = raw === true || raw === 'true'
    } else {
      values[p.name] = String(raw)
    }
  }
  return { ok: true, values }
}
