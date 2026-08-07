import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { buildCatalogueMediaProxyUrl } from '@/lib/catalog/media-proxy'
import { searchCatalogues } from '@/lib/catalog/search'
import type { CatalogProduct } from '@/lib/catalog/types'
import { engineSendMedia } from '@/lib/flows/meta-send'
import { retrieveKnowledge } from '../knowledge'
import type { AgentToolKey } from '../tool-permissions'
import type {
  AgentToolDefinition,
  AgentToolExecutor,
  AiConfig,
} from '../types'

interface PendingProductSend {
  productRef: string
  name: string
  imageUrl: string
  displayImageUrl: string
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
    'Search all active product catalogues, including the quick internal catalogue and connected external website APIs. Returns real names, prices, photos, links, stock and a temporary product_ref that can be passed to send_product. Always use this before recommending a product or quoting a price.',
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
    'Prepare the WhatsApp delivery of one product photo returned by search_catalog. Call this only when the customer asked to see, receive or choose that product. Use the exact temporary product_ref; never pass a URL. The actual send happens only after server-side limits and conversation checks pass.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      product_ref: {
        type: 'string',
        description: 'The exact temporary product_ref returned by search_catalog.',
      },
    },
    required: ['product_ref'],
  },
}

const TOOL_DEFINITIONS: Record<AgentToolKey, AgentToolDefinition> = {
  search_catalog: SEARCH_CATALOG_TOOL,
  send_product: SEND_PRODUCT_TOOL,
  search_knowledge: SEARCH_KNOWLEDGE_TOOL,
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

function buildProductCaption(product: CatalogProduct): string {
  const parts = [
    product.name,
    `${Number(product.price).toLocaleString('pt-PT', {
      maximumFractionDigits: 2,
    })} ${product.currency}`,
  ]
  if (product.stockQuantity !== null) {
    parts.push(
      product.stockQuantity > 0
        ? `Disponível: ${product.stockQuantity}`
        : 'Actualmente sem stock',
    )
  }
  if (product.description) parts.push(product.description)
  if (product.productUrl) parts.push(product.productUrl)
  return parts.join('\n').slice(0, 1024)
}

export function createAutoReplyTools(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  config: Pick<AiConfig, 'embeddingsApiKey'>
  permissions: Record<AgentToolKey, boolean>
}): ToolSet {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    config,
    permissions,
  } = args
  const pendingProductSends: PendingProductSend[] = []
  const availableProducts = new Map<string, CatalogProduct>()
  let productRefSequence = 0

  const executeTool: AgentToolExecutor = async (call) => {
    const toolKey = call.name as AgentToolKey
    if (!(toolKey in permissions) || !permissions[toolKey]) {
      throw new Error(`Tool is disabled for this agent: ${call.name}`)
    }

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
      const referencedProducts = products.map((product) => {
        productRefSequence += 1
        const productRef = `catalog_result_${productRefSequence}`
        availableProducts.set(productRef, product)
        return { ...product, product_ref: productRef }
      })
      return JSON.stringify({
        ok: true,
        query: search.query,
        products: referencedProducts,
        found: referencedProducts.length > 0,
        instruction:
          'Only quote prices and availability returned here. To send a photograph, call send_product with the exact product_ref. Do not use a product id or URL.',
      })
    }

    if (call.name === SEND_PRODUCT_TOOL.name) {
      const productRef =
        typeof input.product_ref === 'string' ? input.product_ref.trim() : ''
      if (!productRef) throw new Error('product_ref is required.')
      if (pendingProductSends.length >= 3) {
        throw new Error('A maximum of three products can be sent per reply.')
      }
      if (pendingProductSends.some((item) => item.productRef === productRef)) {
        return JSON.stringify({ ok: true, queued: true, duplicate: true })
      }

      const product = availableProducts.get(productRef)
      if (!product) {
        throw new Error(
          'Unknown or expired product_ref. Call search_catalog before send_product.',
        )
      }
      if (!product.imageUrl) {
        throw new Error('This product has no photograph to send.')
      }
      const imageUrl = new URL(product.imageUrl)
      if (imageUrl.protocol !== 'https:') {
        throw new Error('The product photograph must use HTTPS.')
      }

      const directImageUrl = imageUrl.toString()
      const deliveryImageUrl = buildCatalogueMediaProxyUrl(directImageUrl) ?? directImageUrl
      if (deliveryImageUrl === directImageUrl && !process.env.NEXT_PUBLIC_SITE_URL) {
        console.warn(
          '[ai send_product] NEXT_PUBLIC_SITE_URL is unset; sending catalogue image directly to Meta.',
        )
      }

      pendingProductSends.push({
        productRef,
        name: product.name,
        imageUrl: deliveryImageUrl,
        displayImageUrl: directImageUrl,
        caption: buildProductCaption(product),
      })

      return JSON.stringify({
        ok: true,
        queued: true,
        product: { product_ref: productRef, name: product.name },
        instruction:
          'The photograph is queued and will be sent after server-side conversation checks pass. Do not repeat the full caption in the final text.',
      })
    }

    throw new Error(`Unknown or unavailable tool: ${call.name}`)
  }

  const tools = (Object.keys(TOOL_DEFINITIONS) as AgentToolKey[])
    .filter((key) => permissions[key])
    .map((key) => TOOL_DEFINITIONS[key])

  return {
    tools,
    executeTool,
    hasPendingActions: () => pendingProductSends.length > 0,
    dispatchPendingActions: async () => {
      let sent = 0
      for (const item of pendingProductSends.splice(0)) {
        console.info('[ai send_product] sending product image:', {
          productRef: item.productRef,
          name: item.name,
          deliveryUrl: item.imageUrl,
          sourceUrl: item.displayImageUrl,
        })

        const result = await engineSendMedia({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          kind: 'image',
          link: item.imageUrl,
          caption: item.caption,
        })

        const { error: enrichError } = await db
          .from('messages')
          .update({ media_url: item.displayImageUrl, ai_generated: true })
          .eq('conversation_id', conversationId)
          .eq('message_id', result.whatsapp_message_id)
        if (enrichError) {
          console.warn(
            '[ai send_product] media sent but inbox metadata update failed:',
            enrichError.message,
          )
        }
        sent += 1
      }
      return sent
    },
  }
}
