import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { loadCatalogTaxonomy, type CatalogTaxonomyGroups } from '@/lib/catalog/taxonomy'

interface Classification {
  color: string | null
  category: string | null
  description: string
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Snaps a free-text value the vision model returned to this account's
 * own canonical taxonomy value when it (or one of its configured
 * aliases) matches — so "Pantalona"/"pantalona"/"PANTALONA" all become
 * the one canonical_value the account defined, instead of becoming
 * three different category strings on different products. Returns the
 * raw value unchanged when nothing in the account's taxonomy matches
 * (including when the account has none configured).
 */
export function snapToCanonicalValue(raw: string | null, groups: readonly (readonly string[])[]): string | null {
  if (!raw) return raw
  const normalizedRaw = normalizeForMatch(raw)
  for (const group of groups) {
    if (group.some((alias) => normalizeForMatch(alias) === normalizedRaw)) {
      return group[0]
    }
  }
  return raw
}

/**
 * Builds the vision-classification system prompt for one account. The
 * category vocabulary comes entirely from that account's own configured
 * taxonomy (wacrm.catalog_taxonomy_terms, kind='category') — this
 * function has no built-in domain knowledge (no fashion terms, no
 * vehicle terms, ...). An account with no configured categories still
 * gets a fully working, domain-neutral classifier: it just proposes its
 * own concise category instead of matching one from a suggested list.
 */
export function buildClassificationSystemPrompt(knownCategories: string[]): string {
  const categoryGuidance =
    knownCategories.length > 0
      ? `Prefer one of this business's own known categories when it genuinely matches what is visible: ${knownCategories.join(', ')}. ` +
        'If none of them genuinely fit, propose a new concise category instead of forcing a mismatch.'
      : 'Propose a concise, reusable category based only on what is visibly true in the photo — you do not know this business\'s category vocabulary in advance, so infer one from the image itself.'

  return (
    'You look at one product photograph and describe only what is visibly true in the image. ' +
    'Respond with nothing but a JSON object: {"color": "<main colour, one or two words, in Portuguese>", "category": "<short product category in Portuguese>", "description": "<2-3 short sentences in Portuguese covering style, fit, pattern and notable details actually visible in the photo>"}. ' +
    `${categoryGuidance} Do not invent a more specific category than the photograph supports. ` +
    'Never invent size, price, stock, brand or material you cannot see. If the colour or category is not clear, use null for that field.'
  )
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

    const taxonomy: CatalogTaxonomyGroups = await loadCatalogTaxonomy(db, accountId)
    const knownCategories = taxonomy.categoryGroups.map((group) => group[0]).filter(Boolean)

    const generated = await generateReply({
      config,
      systemPrompt: buildClassificationSystemPrompt(knownCategories),
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', url: imageUrl }],
        },
      ],
    })

    const classification = parseClassification(generated.text)
    const snapped: Classification = {
      ...classification,
      category: snapToCanonicalValue(classification.category, taxonomy.categoryGroups),
      color: snapToCanonicalValue(classification.color, taxonomy.colorGroups),
    }
    return NextResponse.json(snapped)
  } catch (error) {
    return toErrorResponse(error)
  }
}
