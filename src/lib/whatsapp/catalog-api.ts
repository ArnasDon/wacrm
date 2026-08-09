const META_API_VERSION = 'v23.0'
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
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    error_data?: {
      details?: string
      messaging_product?: string
      [key: string]: unknown
    }
    fbtrace_id?: string
  }
}

async function metaError(
  response: Response,
  fallback: string,
): Promise<never> {
  let message = fallback

  try {
    const rawText = await response.text()

    let body: MetaErrorEnvelope | null = null

    try {
      body = rawText
        ? (JSON.parse(rawText) as MetaErrorEnvelope)
        : null
    } catch {
      if (rawText) {
        message = `${fallback} | ${rawText}`
      }
    }

    if (body?.error) {
      const error = body.error

      const details = [
        error.message,
        error.error_user_title,
        error.error_user_msg,
        error.error_data?.details,
        error.type ? `type=${error.type}` : null,
        error.code != null ? `code=${error.code}` : null,
        error.error_subcode != null
          ? `subcode=${error.error_subcode}`
          : null,
        error.fbtrace_id
          ? `fbtrace_id=${error.fbtrace_id}`
          : null,
      ].filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )

      if (details.length) {
        message = details.join(' | ')
      }

      console.error('[Meta API error]', {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        error,
      })
    }
  } catch (parseError) {
    console.error(
      '[Meta API error] Failed to parse error response:',
      parseError,
    )
  }

  throw new Error(message)
}

export async function getCatalogProducts(args: {
  catalogId: string
  accessToken: string
  limit?: number
}): Promise<MetaCatalogProduct[]> {
  const {
    catalogId,
    accessToken,
    limit = 100,
  } = args

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

  const url =
    `${META_API_BASE}/${catalogId}/products` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=${Math.min(Math.max(limit, 1), 100)}` +
    `&access_token=${encodeURIComponent(accessToken)}`

  const response = await fetch(url, {
    cache: 'no-store',
  })

  if (!response.ok) {
    await metaError(
      response,
      `Meta catalog error: ${response.status}`,
    )
  }

  const body = (await response.json()) as {
    data?: MetaCatalogProduct[]
  }

  return (body.data ?? []).filter(
    (item) => Boolean(item.retailer_id),
  )
}

async function sendInteractive(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  interactive: Record<string, unknown>
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    interactive,
  } = args

  const response = await fetch(
    `${META_API_BASE}/${phoneNumberId}/messages`,
    {
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
    },
  )

  if (!response.ok) {
    await metaError(
      response,
      `Meta product send error: ${response.status}`,
    )
  }

  const body = (await response.json()) as {
    messages?: Array<{ id?: string }>
  }

  const messageId = body.messages?.[0]?.id

  if (!messageId) {
    throw new Error(
      'Meta did not return a WhatsApp message id.',
    )
  }

  return { messageId }
}

async function sendTemplatePayload(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  template: Record<string, unknown>
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    template,
  } = args

  const response = await fetch(
    `${META_API_BASE}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template,
      }),
    },
  )

  if (!response.ok) {
    await metaError(
      response,
      `Meta carousel send error: ${response.status}`,
    )
  }

  const body = (await response.json()) as {
    messages?: Array<{ id?: string }>
  }

  const messageId = body.messages?.[0]?.id

  if (!messageId) {
    throw new Error(
      'Meta did not return a WhatsApp message id.',
    )
  }

  return { messageId }
}

export async function createProductCarouselTemplate(args: {
  wabaId: string
  accessToken: string
  name: string
  language?: string
  bodyText?: string
}): Promise<{ id: string; status?: string }> {
  const {
    wabaId,
    accessToken,
    name,
    language = 'pt_PT',
    bodyText =
      'Veja estas opções disponíveis e escolha a que prefere.',
  } = args

  const card = {
    components: [
      {
        type: 'HEADER',
        format: 'PRODUCT',
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'SPM',
            text: 'Ver',
          },
        ],
      },
    ],
  }

  const payload = {
    name,
    language,
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text: bodyText.slice(0, 1024),
      },
      {
        type: 'CAROUSEL',
        cards: [
          card,
          card,
        ],
      },
    ],
  }

  console.log(
    '[catalog/carousel/template] Meta request:',
    JSON.stringify(
      {
        wabaId,
        apiVersion: META_API_VERSION,
        payload,
      },
      null,
      2,
    ),
  )

  const response = await fetch(
    `${META_API_BASE}/${wabaId}/message_templates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  )

  if (!response.ok) {
    await metaError(
      response,
      `Meta carousel template create error: ${response.status}`,
    )
  }

  const body = (await response.json()) as {
    id?: string
    status?: string
  }

  if (!body.id) {
    throw new Error(
      'Meta did not return a carousel template id.',
    )
  }

  return {
    id: body.id,
    status: body.status,
  }
}

export async function sendProductCarouselTemplate(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  templateName: string
  language?: string
  productRetailerIds: string[]
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    catalogId,
    templateName,
    language = 'pt_PT',
    productRetailerIds,
  } = args

  const ids = Array.from(
    new Set(
      productRetailerIds
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10)

  if (ids.length < 2) {
    throw new Error(
      'A product carousel requires at least two product retailer ids.',
    )
  }

  return sendTemplatePayload({
    phoneNumberId,
    accessToken,
    to,
    template: {
      name: templateName,
      language: {
        code: language,
      },
      components: [
        {
          type: 'carousel',
          cards: ids.map(
            (
              product_retailer_id,
              card_index,
            ) => ({
              card_index,
              components: [
                {
                  type: 'header',
                  parameters: [
                    {
                      type: 'product',
                      product: {
                        catalog_id: catalogId,
                        product_retailer_id,
                      },
                    },
                  ],
                },
              ],
            }),
          ),
        },
      ],
    },
  })
}

export async function sendCatalogProduct(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  productRetailerId: string
  bodyText?: string
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    catalogId,
    productRetailerId,
    bodyText,
  } = args

  return sendInteractive({
    phoneNumberId,
    accessToken,
    to,
    interactive: {
      type: 'product',

      ...(bodyText
        ? {
            body: {
              text: bodyText,
            },
          }
        : {}),

      action: {
        catalog_id: catalogId,
        product_retailer_id:
          productRetailerId,
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
  headerText?: string
  sectionTitle?: string
}): Promise<{ messageId: string }> {
  const {
    phoneNumberId,
    accessToken,
    to,
    catalogId,
    productRetailerIds,
    bodyText =
      'Veja estas opções disponíveis:',
    headerText = 'Produtos disponíveis',
    sectionTitle = 'Produtos',
  } = args

  const ids = Array.from(
    new Set(
      productRetailerIds
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10)

  if (ids.length < 2) {
    throw new Error(
      'A multi-product message requires at least two product retailer ids.',
    )
  }

  return sendInteractive({
    phoneNumberId,
    accessToken,
    to,
    interactive: {
      type: 'product_list',

      header: {
        type: 'text',
        text: headerText.slice(0, 60),
      },

      body: {
        text: bodyText,
      },

      action: {
        catalog_id: catalogId,

        sections: [
          {
            title: sectionTitle.slice(
              0,
              24,
            ),

            product_items: ids.map(
              (product_retailer_id) => ({
                product_retailer_id,
              }),
            ),
          },
        ],
      },
    },
  })
}
