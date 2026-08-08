import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { buildCatalogueMediaProxyUrl } from '@/lib/catalog/media-proxy'
import { searchCatalogues } from '@/lib/catalog/search'
import type { CatalogProduct } from '@/lib/catalog/types'
import { engineSendInteractiveButtons, engineSendMedia } from '@/lib/flows/meta-send'
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

interface PendingProductGallery {
  items: PendingProductSend[]
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
    'Search all active product catalogues. Returns real names, prices, photos, links, stock and a temporary product_ref. Catalogue searches are visual by default: the server presents up to three products with photographs and a selection action attached immediately to each product. Set visual=false only for a precise internal lookup when no browsing presentation should be sent. Never reproduce visual results as a numbered text list.',
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
      visual: {
        type: 'boolean',
        description:
          'Optional. Defaults to true. Set false only for a precise lookup that must not present browsing cards to the customer.',
      },
    },
    required: ['query'],
  },
}

const SEND_PRODUCT_TOOL: AgentToolDefinition = {
  name: 'send_product',
  description:
    'Prepare the WhatsApp delivery of one product photo returned by search_catalog. Call this when the customer explicitly asks to receive or see one specific product. Use the exact temporary product_ref; never pass a URL. If several search results represent the same product, prefer the exact-name result that has a photograph.',
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
  return {
    query,
    limit: Math.min(5, Math.max(1, requestedLimit)),
    visual: input.visual !== false,
  }
}

function normalizeProductSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function rankCatalogueProducts(products: CatalogProduct[], query: string): CatalogProduct[] {
  const normalizedQuery = normalizeProductSearchText(query)
  return products
    .map((product, index) => {
      const normalizedName = normalizeProductSearchText(product.name)
      let score = 0
      if (normalizedName === normalizedQuery) score += 100
      else if (normalizedName.startsWith(normalizedQuery)) score += 60
      else if (normalizedName.includes(normalizedQuery)) score += 30
      if (resolveProductImage(product)) score += 20
      if (product.stockQuantity !== null && product.stockQuantity > 0) score += 5
      return { product, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product)
}

function resolveProductImage(product: CatalogProduct): {
  url: string
  source: 'product' | 'variant'
} | null {
  const candidates: Array<{ url: string | null | undefined; source: 'product' | 'variant' }> = [
    { url: product.imageUrl, source: 'product' },
    ...(product.variants ?? []).map((variant) => ({
      url: variant.imageUrl,
      source: 'variant' as const,
    })),
  ]

  for (const candidate of candidates) {
    if (!candidate.url) continue
    try {
      const parsed = new URL(candidate.url)
      if (parsed.protocol === 'https:') {
        return { url: parsed.toString(), source: candidate.source }
      }
    } catch {
      // Ignore malformed catalogue media URLs and continue to the next candidate.
    }
  }
  return null
}

function buildProductCaption(product: CatalogProduct, visualCard = false): string {
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
  if (visualCard) {
    parts.push('Seleccione este produto abaixo para ver os detalhes.')
  }
  return parts.join('\n').slice(0, 1024)
}

function buildPendingProduct(
  productRef: string,
  product: CatalogProduct,
  visualCard = false,
): PendingProductSend | null {
  const resolvedImage = resolveProductImage(product)
  if (!resolvedImage) {
    console.info('[ai product gallery] no valid image resolved:', {
      productRef,
      name: product.name,
      productImageUrl: product.imageUrl,
      variantImageUrls: (product.variants ?? [])
        .map((variant) => variant.imageUrl)
        .filter(Boolean),
    })
    return null
  }

  const directImageUrl = resolvedImage.url
  const deliveryImageUrl = buildCatalogueMediaProxyUrl(directImageUrl) ?? directImageUrl

  console.info('[ai product gallery] image resolved:', {
    productRef,
    name: product.name,
    source: resolvedImage.source,
    imageUrl: directImageUrl,
  })

  return {
    productRef,
    name: product.name,
    imageUrl: deliveryImageUrl,
    displayImageUrl: directImageUrl,
    caption: buildProductCaption(product, visualCard),
  }
}

function compactButtonTitle(name: string, index: number): string {
  const cleaned = name.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 20) return cleaned
  const prefix = `Opção ${index + 1}: `
  const available = Math.max(1, 20 - prefix.length)
  return `${prefix}${cleaned.slice(0, available)}`.slice(0, 20)
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
  const pendingProductGalleries: PendingProductGallery[] = []
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
      const products = rankCatalogueProducts(
        await searchCatalogues(db, accountId, search),
        search.query,
      )
      const referencedProducts = products.map((product) => {
        productRefSequence += 1
        const productRef = `catalog_result_${productRefSequence}`
        availableProducts.set(productRef, product)
        return { ...product, product_ref: productRef }
      })

      console.info('[ai product gallery] catalogue candidates:',
        referencedProducts.slice(0, 5).map((product) => ({
          productRef: product.product_ref,
          name: product.name,
          productImageUrl: product.imageUrl,
          variantImageUrls: (product.variants ?? [])
            .map((variant) => variant.imageUrl)
            .filter(Boolean),
          resolvedImage: resolveProductImage(product)?.url ?? null,
        })),
      )

      let visualQueued = false
      if (search.visual && referencedProducts.length > 0) {
        const visualItems = referencedProducts
          .slice(0, 3)
          .map((product) =>
            buildPendingProduct(
              product.product_ref,
              product as CatalogProduct,
              true,
            ),
          )
          .filter((item): item is PendingProductSend => Boolean(item))

        if (visualItems.length > 0) {
          pendingProductGalleries.push({ items: visualItems })
          visualQueued = true
        }
      }

      return JSON.stringify({
        ok: true,
        query: search.query,
        products: referencedProducts,
        found: referencedProducts.length > 0,
        visual_queued: visualQueued,
        instruction: visualQueued
          ? 'The server queued a visual WhatsApp product selection. Each photograph, product information and its own selection button will be delivered together in sequence. Do not repeat product names or prices in the final text, do not make a numbered list, and do not ask the customer to type a number or product name. Reply only with a very short introduction such as "Veja estas opções:".'
          : 'Only quote prices and availability returned here. To send one photograph, call send_product with the exact product_ref. Do not use a product id or URL.',
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
      const pending = buildPendingProduct(productRef, product)
      if (!pending) {
        throw new Error('This product has no valid HTTPS photograph to send.')
      }
      pendingProductSends.push(pending)

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
    hasPendingActions: () =>
      pendingProductSends.length > 0 || pendingProductGalleries.length > 0,
    dispatchPendingActions: async () => {
      let sent = 0

      // WhatsApp does not visually bind a later multi-button message to the
      // media messages that precede it. Keep each product atomic instead:
      // image/caption -> that product's single selection button -> next item.
      // Awaiting every send also preserves the intended ordering end-to-end.
      for (const gallery of pendingProductGalleries.splice(0)) {
        for (const [index, item] of gallery.items.entries()) {
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
              '[ai product gallery] media sent but inbox metadata update failed:',
              enrichError.message,
            )
          }
          sent += 1

          await engineSendInteractiveButtons({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            bodyText: `Seleccionar ${item.name}`.slice(0, 1024),
            footerText: 'Toque para ver detalhes, tamanhos e cores.',
            buttons: [
              {
                id: `product:${item.productRef}`,
                title: compactButtonTitle(item.name, index),
              },
            ],
          })
          sent += 1
        }
      }

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
