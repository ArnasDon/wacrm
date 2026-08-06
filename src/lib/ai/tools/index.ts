import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { searchCatalogues } from '@/lib/catalog/search'
import { retrieveKnowledge } from '../knowledge'
import type {
  AgentToolDefinition,
  AgentToolExecutor,
  AiConfig,
} from '../types'

interface ToolSet {
  tools: AgentToolDefinition[]
  executeTool: AgentToolExecutor
}

const SEARCH_KNOWLEDGE_TOOL: AgentToolDefinition = {
  name: 'search_knowledge',
  description:
    'Search the company knowledge base for services, policies or factual information. Use this when the customer asks about the company and no structured catalogue search is needed.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'A concise search query.' },
      limit: { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: ['query'],
  },
}

const SEARCH_CATALOG_TOOL: AgentToolDefinition = {
  name: 'search_catalog',
  description:
    'Search all active product catalogues, including the quick internal catalogue and connected external website APIs. Returns real names, prices, photos, links and stock when available. Always use this before recommending a product or quoting a price.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description: 'Product name, category, colour, size or customer need.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Maximum number of products to return.',
      },
    },
    required: ['query'],
  },
}

function parseObject(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Tool arguments are not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be a JSON object.')
  }
  return value as Record<string, unknown>
}

function parseSearchInput(input: Record<string, unknown>) {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw new Error('query is required.')
  if (query.length > 500) throw new Error('query is too long.')
  const requestedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : 5
  return { query, limit: Math.min(5, Math.max(1, requestedLimit)) }
}

export function createAutoReplyTools(args: {
  db: WacrmSupabaseClient
  accountId: string
  config: Pick<AiConfig, 'embeddingsApiKey'>
}): ToolSet {
  const { db, accountId, config } = args

  const executeTool: AgentToolExecutor = async (call) => {
    const input = parseObject(call.arguments)
    const search = parseSearchInput(input)

    if (call.name === SEARCH_KNOWLEDGE_TOOL.name) {
      const matches = await retrieveKnowledge(
        db,
        accountId,
        config,
        search.query,
        search.limit,
      )
      return JSON.stringify({
        ok: true,
        query: search.query,
        matches,
        found: matches.length > 0,
      })
    }

    if (call.name === SEARCH_CATALOG_TOOL.name) {
      const products = await searchCatalogues(db, accountId, search)
      return JSON.stringify({
        ok: true,
        query: search.query,
        products,
        found: products.length > 0,
        instruction:
          'Only quote prices and availability returned here. Include the product photo or link when present.',
      })
    }

    throw new Error(`Unknown or unavailable tool: ${call.name}`)
  }

  return {
    tools: [SEARCH_CATALOG_TOOL, SEARCH_KNOWLEDGE_TOOL],
    executeTool,
  }
}
