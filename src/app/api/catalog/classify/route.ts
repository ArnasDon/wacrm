import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'

interface Classification {
  color: string | null
  description: string
}

function parseClassification(raw: string): Classification {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { color: null, description: raw.trim().slice(0, 500) }
  try {
    const parsed = JSON.parse(match[0]) as { color?: unknown; description?: unknown }
    return {
      color: typeof parsed.color === 'string' && parsed.color.trim() ? parsed.color.trim() : null,
      description:
        typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 500) : '',
    }
  } catch {
    return { color: null, description: raw.trim().slice(0, 500) }
  }
}

/**
 * POST /api/catalog/classify — looks at a product photo already uploaded to
 * the catalog bucket and suggests a colour + a short, search-friendly
 * description (style, fit, pattern). Used by the bulk product uploader so
 * the shop owner doesn't have to write these by hand for every item; the
 * result is always shown as an editable suggestion, never saved directly.
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
        'You look at one product photograph (clothing) and describe only what is visibly true in the image. ' +
        'Respond with nothing but a JSON object: {"color": "<main colour, one or two words, in Portuguese>", "description": "<2-3 short sentences in Portuguese covering style, fit, pattern and notable details actually visible in the photo>"}. ' +
        'Never invent size, price, stock, brand or material you cannot see. If the colour is not clear, use null.',
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
