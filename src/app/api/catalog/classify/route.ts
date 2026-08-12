import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'

interface Classification {
  color: string | null
  category: string | null
  description: string
}

function parseClassification(raw: string): Classification {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) {
    return { color: null, category: null, description: raw.trim().slice(0, 500) }
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      color?: unknown
      category?: unknown
      description?: unknown
    }
    return {
      color:
        typeof parsed.color === 'string' && parsed.color.trim()
          ? parsed.color.trim().slice(0, 100)
          : null,
      category:
        typeof parsed.category === 'string' && parsed.category.trim()
          ? parsed.category.trim().slice(0, 120)
          : null,
      description:
        typeof parsed.description === 'string'
          ? parsed.description.trim().slice(0, 500)
          : '',
    }
  } catch {
    return { color: null, category: null, description: raw.trim().slice(0, 500) }
  }
}

/**
 * POST /api/catalog/classify — looks at a product photo already uploaded to
 * the catalog bucket and suggests colour, product category and a short,
 * search-friendly description. Used by both the bulk uploader and the
 * "Reclassificar tudo com IA" action. Suggestions remain editable by the
 * catalogue owner before/after persistence.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const imageUrl = typeof body?.image_url === 'string' ? body.image_url.trim() : ''
    if (!imageUrl) {
      return NextResponse.json({ error: 'image_url is required.' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA para poder classificar fotos.' },
        { status: 409 },
      )
    }

    const generated = await generateReply({
      config,
      systemPrompt:
        'You look at one product photograph and describe only what is visibly true in the image. ' +
        'Respond with nothing but a JSON object: {"color": "<main colour, one or two words, in Portuguese>", "category": "<short product category in Portuguese>", "description": "<2-3 short sentences in Portuguese covering style, fit, pattern and notable details actually visible in the photo>"}. ' +
        'Use a concise reusable category that customers would naturally search for, for example legging, top, camisola, t-shirt, calção, saia-calção, macacão, conjunto, sapatilha or acessório when that is genuinely visible. Do not invent a more specific category than the photograph supports. ' +
        'Never invent size, price, stock, brand or material you cannot see. If the colour or category is not clear, use null for that field.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', url: imageUrl }],
        },
      ],
    })

    const classification = parseClassification(generated.text)
    return NextResponse.json(classification)
  } catch (error) {
    return toErrorResponse(error)
  }
}
