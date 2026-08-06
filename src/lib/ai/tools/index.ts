import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { searchCatalogues } from '@/lib/catalog/search'
import { engineSendMedia } from '@/lib/flows/meta-send'
import { retrieveKnowledge } from '../knowledge'
import type {
  AgentToolDefinition,
  AgentToolExecutor,
  AiConfig,
} from '../types'

interface PendingProductSend {
  productId: string
  name: string
  imageUrl: string
  caption: string
}

interface ToolSet {
  tools: AgentToolDefinition[]
  executeTool: AgentToolExecutor
  dispatchPendingActions: () => Promise<number>
  hasPendingActions: () => boolean
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

const SEND_PRODUCT_TOOL: AgentToolDefinition = {
  name: 'send_product',
  description:
    'Prepare the WhatsApp delivery of one product photo from the internal catalogue. Call this only after search_catalog and only when the customer asked to see, receive or choose that product. The actual send happens after server-side limits and conversation checks pass.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      product_id: {
        type: 'string',
        description: 'The exact internal catalogue product id returned by search_catalog.',
      },
    },
    required: ['product_id'],
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

function buildProductCaption(product: {
  name: string
  price: number | string
  currency: string
  description: string | null
  product_url: string | null
  stock_quantity: number | null
}): string {
  const parts = [
    product.name,
    `${Number(product.price).toLocaleString('pt-PT', {
      maximumFractionDigits: 2,
    })} ${product.currency}`,
  ]
  if (product.stock_quantity !== null) {
    parts.push(
      product.stock_quantity > 0
        ? `Disponível: ${product.stock_quantity}`
        : 'Actualmente sem stock',
    )
  }
  if (product.description) parts.push(product.description)
  if (product.product_url) parts.push(product.product_url)
  return parts.join('\n').slice(0, 1024)
}

export function createAutoReplyTools(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  config: Pick<AiConfig, 'embeddingsApiKey'>
}): ToolSet {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    config,
  } = args
  const pendingProductSends: PendingProductSend[] = []

  const executeTool: AgentToolExecutor = async (call) => {
    const input = parseObject(call.arguments)

    if (call.name === SEARCH_KNOWLEDGE_TOOL.name) {
      const search = parseSearchInput(input)
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
      const search = parseSearchInput(input)
      const products = await searchCatalogues(db, accountId, search)
      return JSON.stringify({
        ok: true,
        query: search.query,
        products,
        found: products.length > 0,
        instruction:
          'Only quote prices and availability returned here. To send a photo, call send_product only for an internal catalogue product whose id is returned here.',
      })
    }

    if (call.name === SEND_PRODUCT_TOOL.name) {
      const productId =
        typeof input.product_id === 'string' ? input.product_id.trim() : ''
      if (!productId) throw new Error('product_id is required.')
      if (pendingProductSends.length >= 3) {
        throw new Error('A maximum of three products can be sent per reply.')
      }
      if (pendingProductSends.some((item) => item.productId === productId)) {
        return JSON.stringify({ ok: true, queued: true, duplicate: true })
      }

      const { data: product, error } = await db
        .from('catalog_products')
        .select(
          'id, name, description, price, currency, image_url, product_url, stock_quantity, is_active',
        )
        .eq('id', productId)
        .eq('account_id', accountId)
        .eq('is_active', true)
        .maybeSingle()

      if (error || !product) throw new Error('Product not found or inactive.')
      if (!product.image_url) {
        throw new Error('This product has no photograph to send.')
      }
      const imageUrl = new URL(product.image_url)
      if (imageUrl.protocol !== 'https:') {
        throw new Error('The product photograph must use HTTPS.')
      }

      pendingProductSends.push({
        productId: product.id,
        name: product.name,
        imageUrl: imageUrl.toString(),
        caption: buildProductCaption(product),
      })

      return JSON.stringify({
        ok: true,
        queued: true,
        product: { id: product.id, name: product.name },
        instruction:
          'The photograph is queued and will be sent after server-side conversation checks pass. Do not repeat the full caption in the final text.',
      })
    }

    throw new Error(`Unknown or unavailable tool: ${call.name}`)
  }

  return {
    tools: [SEARCH_CATALOG_TOOL, SEND_PRODUCT_TOOL, SEARCH_KNOWLEDGE_TOOL],
    executeTool,
    hasPendingActions: () => pendingProductSends.length > 0,
    dispatchPendingActions: async () => {
      let sent = 0
      for (const item of pendingProductSends.splice(0)) {
        await engineSendMedia({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          kind: 'image',
          link: item.imageUrl,
          caption: item.caption,
        })
        sent += 1
      }
      return sent
    },
  }
}
