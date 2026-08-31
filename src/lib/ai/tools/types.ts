// ============================================================
// Shared types for AI agent tool calling — account-configured HTTP
// calls (get/post/etc, with optional auth) the agent can invoke
// mid-conversation. See `supabase/migrations/040_ai_tools.sql` for the
// backing table.
// ============================================================

export type ToolParamLocation = 'query' | 'body' | 'path' | 'header'
export type ToolParamType = 'string' | 'number' | 'boolean'
export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ToolAuthType = 'none' | 'bearer' | 'api_key' | 'basic'

/** One argument the tool accepts. Drives both the JSON-schema handed to
 *  the model (`schema.ts`) and the request built at call time
 *  (`execute.ts`). */
export interface ToolParameter {
  name: string
  in: ToolParamLocation
  type: ToolParamType
  description?: string
  required: boolean
  /** Restricts the model to one of these string values, when set. */
  enum?: string[]
}

/**
 * An account's tool, decrypted and ready to call. Produced by
 * `loadAiTools` — `authSecret` is the plaintext credential for the
 * THIRD-PARTY endpoint (stored AES-256-GCM-encrypted at rest), null
 * when `authType` is `'none'`.
 */
export interface AiTool {
  id: string
  accountId: string
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: Record<string, string>
  authType: ToolAuthType
  authHeaderName: string | null
  authSecret: string | null
  parameters: ToolParameter[]
  timeoutMs: number
}

/** The request actually sent, with any credential redacted — safe to
 *  log / persist / show in the UI. */
export interface ToolExecutionRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

/** Outcome of one `executeTool` call. Never thrown — a failure (bad
 *  args, SSRF-blocked, timeout, non-2xx) is represented here so the
 *  agentic loop can feed it back to the model as a tool result. */
export interface ToolExecutionResult {
  ok: boolean
  status: number | null
  statusText: string | null
  /** Response body, JSON or text, truncated to bound token usage when
   *  this re-enters the prompt. */
  body: string | null
  durationMs: number
  error: string | null
  request: ToolExecutionRequest
}

/** One tool invocation within a single `generateReply` call — what
 *  callers (auto-reply, playground) persist / display. */
export interface ToolCallRecord {
  toolName: string
  args: Record<string, unknown>
  result: ToolExecutionResult
}
