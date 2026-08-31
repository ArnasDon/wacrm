import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiTool, ToolParameter } from './types'

interface AiToolRow {
  id: string
  account_id: string
  name: string
  description: string
  method: string
  url: string
  headers: Record<string, string> | null
  auth_type: string
  auth_header_name: string | null
  auth_secret: string | null
  parameters: unknown
  timeout_ms: number
}

const TOOL_COLUMNS =
  'id, account_id, name, description, method, url, headers, auth_type, auth_header_name, auth_secret, parameters, timeout_ms'

/**
 * Load the account's active tools, decrypted and ready to call.
 * Mirrors `loadAiConfig` (src/lib/ai/config.ts): best-effort per row —
 * a tool whose secret can't be decrypted (rotated `ENCRYPTION_KEY`) is
 * dropped rather than failing the whole reply, with a loud
 * `console.error` breadcrumb so it doesn't fail silently forever.
 *
 * Works with any client — the RLS-scoped SSR client from a dashboard
 * route, or the service-role admin client from the auto-reply path.
 */
export async function loadAiTools(
  db: SupabaseClient,
  accountId: string,
): Promise<AiTool[]> {
  const { data, error } = await db
    .from('ai_tools')
    .select(TOOL_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!data) return []

  const tools: AiTool[] = []
  for (const row of data as AiToolRow[]) {
    const tool = rowToTool(row)
    if (tool) tools.push(tool)
  }
  return tools
}

/**
 * Load + decrypt a single tool by id, scoped to the account (regardless
 * of `is_active` — the Tools tab's "Test tool" button needs to test a
 * tool before flipping it on, same as the agent Playground testing a
 * not-yet-active AI config). Returns null when missing, not owned by
 * this account, or its secret can't be decrypted.
 */
export async function loadAiToolById(
  db: SupabaseClient,
  accountId: string,
  toolId: string,
): Promise<AiTool | null> {
  const { data, error } = await db
    .from('ai_tools')
    .select(TOOL_COLUMNS)
    .eq('id', toolId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return rowToTool(data as AiToolRow)
}

/** Shared row → `AiTool` mapping, including the secret decrypt. Returns
 *  null (rather than throwing) when the secret can't be decrypted, so
 *  every caller gets the same "drop this tool" treatment. */
function rowToTool(row: AiToolRow): AiTool | null {
  let authSecret: string | null = null
  if (row.auth_type !== 'none' && row.auth_secret) {
    try {
      authSecret = decrypt(row.auth_secret)
    } catch {
      console.error(
        `[ai tools] tool "${row.name}" (${row.id}) secret could not be decrypted — check ENCRYPTION_KEY.`,
      )
      return null
    }
  }
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description,
    method: row.method as AiTool['method'],
    url: row.url,
    headers: row.headers ?? {},
    authType: row.auth_type as AiTool['authType'],
    authHeaderName: row.auth_header_name,
    authSecret,
    parameters: normalizeParameters(row.parameters),
    timeoutMs: row.timeout_ms,
  }
}

function normalizeParameters(raw: unknown): ToolParameter[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (p): p is ToolParameter =>
      !!p && typeof p === 'object' && typeof (p as ToolParameter).name === 'string',
  )
}
