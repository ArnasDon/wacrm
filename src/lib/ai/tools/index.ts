import type { WacrmSupabaseClient } from '@/lib/supabase/types'
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
    'Search the company knowledge base for products, services, prices, policies, catalogues or other factual information. Use this before saying that information is unavailable.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description: 'A concise search query based on the customer request.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Maximum number of relevant excerpts to return.',
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

/**
 * Build the tools available to the inbound assistant for one tenant.
 *
 * This first milestone deliberately exposes only a read-only operation.
 * Future CRM mutations must be added as separate tools with explicit
 * validation, audit logging, idempotency and permission checks.
 */
export function createAutoReplyTools(args: {
  db: WacrmSupabaseClient
  accountId: string
  config: Pick<AiConfig, 'embeddingsApiKey'>
}): ToolSet {
  const { db, accountId, config } = args

  const executeTool: AgentToolExecutor = async (call) => {
    if (call.name !== SEARCH_KNOWLEDGE_TOOL.name) {
      throw new Error(`Unknown or unavailable tool: ${call.name}`)
    }

    const input = parseObject(call.arguments)
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) throw new Error('query is required.')
    if (query.length > 500) throw new Error('query is too long.')

    const requestedLimit =
      typeof input.limit === 'number' && Number.isFinite(input.limit)
        ? Math.floor(input.limit)
        : 5
    const limit = Math.min(5, Math.max(1, requestedLimit))
    const matches = await retrieveKnowledge(db, accountId, config, query, limit)

    return JSON.stringify({
      ok: true,
      query,
      matches,
      found: matches.length > 0,
    })
  }

  return { tools: [SEARCH_KNOWLEDGE_TOOL], executeTool }
}
