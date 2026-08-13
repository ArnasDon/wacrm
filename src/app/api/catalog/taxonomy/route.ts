import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const MAX_ALIASES = 30

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`)
  const cleaned = value.trim()
  if (!cleaned) throw new Error(`${field} is required.`)
  if (cleaned.length > max) throw new Error(`${field} is too long.`)
  return cleaned
}

function aliasList(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('aliases must be an array of text.')
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_ALIASES)
  return Array.from(new Set(cleaned))
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * GET /api/catalog/taxonomy — this account's own category/colour terms,
 * each with an approximate count of internal catalog_products currently
 * matching it (by canonical value or alias) so the admin can see impact
 * before editing/deleting a term. External-source products aren't
 * counted here — that count would require querying every connected
 * external database, which isn't worth it for an approximate figure.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [{ data: terms, error: termsError }, { data: products, error: productsError }] = await Promise.all([
      supabase
        .from('catalog_taxonomy_terms')
        .select('id, kind, canonical_value, aliases, enabled, created_at')
        .eq('account_id', accountId)
        .order('kind', { ascending: true })
        .order('canonical_value', { ascending: true }),
      supabase.from('catalog_products').select('category, color').eq('account_id', accountId),
    ])
    if (termsError) throw termsError
    if (productsError) throw productsError

    const categoryValues = (products ?? []).map((p) => normalize(p.category ?? '')).filter(Boolean)
    const colorValues = (products ?? []).map((p) => normalize(p.color ?? '')).filter(Boolean)

    const withCounts = (terms ?? []).map((term) => {
      const haystack = term.kind === 'color' ? colorValues : categoryValues
      const needles = [term.canonical_value, ...(term.aliases ?? [])].map(normalize)
      const productCount = haystack.filter((value) => needles.includes(value)).length
      return { ...term, productCount }
    })

    return NextResponse.json({ terms: withCounts })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const kind = input.kind === 'color' ? 'color' : input.kind === 'category' ? 'category' : null
    if (!kind) return NextResponse.json({ error: 'kind must be "category" or "color".' }, { status: 400 })
    const canonicalValue = requiredText(input.canonical_value, 80, 'canonical_value')
    const aliases = aliasList(input.aliases)

    const { data, error } = await supabase
      .from('catalog_taxonomy_terms')
      .insert({ account_id: accountId, kind, canonical_value: canonicalValue, aliases })
      .select('id, kind, canonical_value, aliases, enabled, created_at')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Já existe uma categoria/cor com este nome.' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ term: { ...data, productCount: 0 } }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
