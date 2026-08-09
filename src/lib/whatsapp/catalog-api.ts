const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaCatalogProduct {
  id: string
  retailer_id: string
  name?: string
  description?: string
  price?: string
  currency?: string
  image_url?: string
  url?: string
  availability?: string
}

interface MetaErrorEnvelope {
  error?: { message?: string }
}

async function metaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as MetaErrorEnvelope
    if (body.error?.message) message = body.error.message
  } catch {
    // Keep fallback when Meta did not return JSON.
  }
  throw new Error(message)
}

export async function getCatalogProducts(args: {
  catalogId: string
  accessToken: string
  limit?: number
}): Promise<MetaCatalogProduct[]> {
  const { catalogId, accessToken, limit = 100 } = args
  const fields = [
    'id',
    'retailer_id',
    'name',
    'description',
    'price',
    'currency',
    'image_url',
    'url',
    'availability',
  ].join(',')
  const url = `${META_API_BASE}/${catalogId}/products?fields=${encodeURIComponent(fields)}&limit=${Math.min(Math.max(limit, 1), 100)}&access_token=${encodeURIComponent(accessToken)}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) await metaError(response, `Meta catalog error: ${response.status}`)
  const body = (await response.json()) as { data?: MetaCatalogProduct[] }
  return (body.data ?? []).filter((item) => Boolean(item.retailer_id))
}

async function sendInteractive(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  interactive: Record<string, unknown>
}): Promise<{ messageId: string }> {
  const { phoneNumberId, accessToken, to, interactive } = args
  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
    }),
  })
  if (!response.ok) await metaError(response, `Meta product send error: ${response.status}`)
  const body = (await response.json()) as { messages?: Array<{ id?: string }> }
  const messageId = body.messages?.[0]?.id
  if (!messageId) throw new Error('Meta did not return a WhatsApp message id.')
  return { messageId }
}

export async function sendCatalogProduct(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  productRetailerId: string
  bodyText?: string
}): Promise<{ messageId: string }> {
  const { phoneNumberId, accessToken, to, catalogId, productRetailerId, bodyText } = args
  return sendInteractive({
    phoneNumberId,
    accessToken,
    to,
    interactive: {
      type: 'product',
      ...(bodyText ? { body: { text: bodyText } } : {}),
      action: {
        catalog_id: catalogId,
        product_retailer_id: productRetailerId,
      },
    },
  })
}

export async function sendCatalogProductList(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  productRetailerIds: string[]
  bodyText?: string
  sectionTitle?: string
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    catalogId,
    productRetailerIds,
    bodyText = 'Veja estas opções disponíveis:',
    sectionTitle = 'Produtos',
  } = args

  const ids = Array.from(new Set(productRetailerIds.map((id) => id.trim()).filter(Boolean))).slice(0, 10)
  if (ids.length < 2) {
    throw new Error('A multi-product message requires at least two product retailer ids.')
  }

  return sendInteractive({
    phoneNumberId,
    accessToken,
    to,
    interactive: {
      type: 'product_list',
      body: { text: bodyText },
      action: {
        catalog_id: catalogId,
        sections: [
          {
            title: sectionTitle.slice(0, 24),
            product_items: ids.map((product_retailer_id) => ({ product_retailer_id })),
          },
        ],
      },
    },
  })
}
