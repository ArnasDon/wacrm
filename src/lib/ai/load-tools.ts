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
 * Every tool takes a single `query: string` parameter — the model
 * decides what to search for; wacrm just runs the search. Accounts
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
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in this sheet (e.g. a product name, SKU, phone number, or order id).',
        },
      },
      required: ['query'],
    },
  }))

  const executeTool: ExecuteTool = async (name, args) => {
    const tool = byName.get(name)
    if (!tool) return `Error: no existe la herramienta "${name}".`
    const query = typeof args.query === 'string' ? args.query : ''
    return runGoogleSheetTool(tool, query)
  }

  return { definitions, executeTool }
}
