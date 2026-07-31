import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExecuteTool, ToolDefinition } from './types'
import { runGoogleSheetTool } from './tools/google-sheet'

interface AiToolRow {
  name: string
  description: string
  sheet_url: string
}

/**
 * Load an account's connected tools (Google Sheets, migration 042) as
 * a `{definitions, executeTool}` pair ready to hand to `generateReply`.
 *
 * Each tool takes no arguments — calling it returns the sheet's full
 * content (capped) rather than a filtered row search. Real pricing/
 * schedule sheets are often laid out as a matrix with headers split
 * across several rows, so a "find the row matching X" search misses
 * the data half the time; handing the model the whole small sheet and
 * letting it read the table itself is far more reliable. Accounts
 * with no active tools get `definitions: []`, and the provider
 * adapters skip the `tools` field entirely in that case (no behavior
 * or cost change for accounts not using this feature).
 */
export async function loadAiTools(
  db: SupabaseClient,
  accountId: string,
): Promise<{ definitions: ToolDefinition[]; executeTool: ExecuteTool }> {
  const { data, error } = await db
    .from('ai_tools')
    .select('name, description, sheet_url')
    .eq('account_id', accountId)
    .eq('is_active', true)

  const rows = (error ? [] : (data as AiToolRow[] | null)) ?? []
  if (error) {
    console.error('[ai tools] failed to load account tools:', error)
  }

  const byName = new Map(rows.map((r) => [r.name, r]))

  const definitions: ToolDefinition[] = rows.map((r) => ({
    name: r.name,
    description: r.description,
    parameters: { type: 'object', properties: {}, required: [] },
  }))

  const executeTool: ExecuteTool = async (name) => {
    const tool = byName.get(name)
    if (!tool) return `Error: no existe la herramienta "${name}".`
    return runGoogleSheetTool(tool)
  }

  return { definitions, executeTool }
}
