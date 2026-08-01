import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExecuteTool, ToolDefinition } from './types'
import { runGoogleSheetTool } from './tools/google-sheet'
import { runApiTool, type ApiToolParam } from './tools/api'

interface AiToolRow {
  name: string
  description: string
  type: 'google_sheet' | 'api'
  sheet_url: string | null
  api_url: string | null
  api_method: string
  api_params: ApiToolParam[]
  api_headers: Record<string, string>
  api_body: string | null
  api_key_encrypted: string | null
}

/**
 * Load an account's connected tools — Google Sheets (migration 042)
 * and generic HTTP APIs (migration 044) — as a `{definitions,
 * executeTool}` pair ready to hand to `generateReply`.
 *
 * A Google Sheets tool takes no arguments — calling it returns the
 * sheet's full content (capped) rather than a filtered row search.
 * Real pricing/schedule sheets are often laid out as a matrix with
 * headers split across several rows, so a "find the row matching X"
 * search misses the data half the time; handing the model the whole
 * small sheet and letting it read the table itself is far more
 * reliable. An API tool's arguments come from its configured
 * `api_params` (e.g. a weather API's "city").
 *
 * Accounts with no active tools get `definitions: []`, and the
 * provider adapters skip the `tools` field entirely in that case (no
 * behavior or cost change for accounts not using this feature).
 */
export async function loadAiTools(
  db: SupabaseClient,
  accountId: string,
): Promise<{ definitions: ToolDefinition[]; executeTool: ExecuteTool }> {
  const { data, error } = await db
    .from('ai_tools')
    .select(
      'name, description, type, sheet_url, api_url, api_method, api_params, api_headers, api_body, api_key_encrypted',
    )
    .eq('account_id', accountId)
    .eq('is_active', true)

  const rows = (error ? [] : (data as AiToolRow[] | null)) ?? []
  if (error) {
    console.error('[ai tools] failed to load account tools:', error)
  }

  const byName = new Map(rows.map((r) => [r.name, r]))

  const definitions: ToolDefinition[] = rows.map((r) => {
    if (r.type === 'api') {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const p of r.api_params ?? []) {
        properties[p.name] = { type: 'string', description: p.description }
        if (p.required) required.push(p.name)
      }
      return {
        name: r.name,
        description: r.description,
        parameters: { type: 'object', properties, required },
      }
    }
    return {
      name: r.name,
      description: r.description,
      parameters: { type: 'object', properties: {}, required: [] },
    }
  })

  const executeTool: ExecuteTool = async (name, args) => {
    const tool = byName.get(name)
    if (!tool) return `Error: no existe la herramienta "${name}".`
    if (tool.type === 'api') {
      if (!tool.api_url) return `Error: la herramienta "${name}" no tiene una URL configurada.`
      return runApiTool(
        {
          api_url: tool.api_url,
          api_method: tool.api_method,
          api_params: tool.api_params ?? [],
          api_headers: tool.api_headers ?? {},
          api_body: tool.api_body,
          api_key_encrypted: tool.api_key_encrypted,
        },
        args,
      )
    }
    if (!tool.sheet_url) return `Error: la herramienta "${name}" no tiene una planilla configurada.`
    return runGoogleSheetTool({ sheet_url: tool.sheet_url })
  }

  return { definitions, executeTool }
}
