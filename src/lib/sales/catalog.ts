// ============================================================
// Catalogue matching + rule-based order detection.
//
// Pure functions (no I/O) so they're unit-testable and safe to run
// on untrusted inbound text: input is length-capped and every regex
// here is linear (no nested quantifiers → no ReDoS).
// ============================================================

import { formatMoney } from '@/lib/money'

export interface CatalogItem {
  _id: string
  name: string
  sku: string | null
  price: number
  stock: number | null
  aliases: string[]
  unit: string
  category: string | null
  description: string | null
  /** Public photo URLs (Cloudinary), cover first. */
  imageUrls?: string[]
}

const MAX_TEXT = 1000

export function normalize(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 3 && word.endsWith('es') && /(s|x|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean).map(singular)
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20,
}

const STOP = new Set(['i', 'want', 'need', 'please', 'pls', 'buy', 'order', 'and', 'of', 'the', 'x', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'send', 'me', 'give', 'get', 'for', 'with', 'abeg', 'make', 'una', 'wan'])

/** Every name a product is known by, tokenised. */
function productNames(p: CatalogItem): string[][] {
  return [p.name, ...(p.sku ? [p.sku] : []), ...p.aliases].map(tokens).filter((t) => t.length > 0)
}

/** How well does `phrase` (tokens) match a product? 0..1 */
function scoreMatch(phrase: string[], p: CatalogItem): number {
  let best = 0
  const phraseSet = new Set(phrase)
  for (const name of productNames(p)) {
    const hits = name.filter((t) => phraseSet.has(t)).length
    if (hits === 0) continue
    // Fraction of the product name present in the phrase, lightly
    // penalising phrases with many unrelated words.
    const coverage = hits / name.length
    const precision = hits / Math.max(phrase.length, 1)
    best = Math.max(best, coverage * 0.8 + precision * 0.2)
  }
  return best
}

export interface DetectedLine {
  product: CatalogItem
  quantity: number
  confidence: number
}

/**
 * Parse an order out of free text:
 *   "I want 2 red shoes and 3 bottles of zobo"
 *   "3x Ankara fabric, 1 head tie"
 *   "abeg send me two jollof rice"
 * Segments on commas / "and" / newlines, reads a leading or trailing
 * quantity from each segment, and matches the rest to the catalogue.
 */
export function detectOrder(text: string, catalog: CatalogItem[]): DetectedLine[] {
  const clean = normalize(text)
  if (!clean || catalog.length === 0) return []
  // "can I see a picture of the lace" is a request to look, not to buy.
  if (PHOTO_WORDS.test(clean)) return []
  const segments = clean.split(/\s*(?:,|\band\b|\bplus\b|\n|;)\s*/).filter(Boolean)
  const lines = new Map<string, DetectedLine>()

  for (const seg of segments) {
    const words = seg.split(' ')
    let quantity: number | null = null
    const rest: string[] = []
    for (const w of words) {
      const numeric = /^x?(\d{1,4})x?$/.exec(w)
      if (quantity === null && numeric) {
        quantity = Number(numeric[1])
        continue
      }
      if (quantity === null && w in NUMBER_WORDS) {
        quantity = NUMBER_WORDS[w]
        continue
      }
      if (!STOP.has(w)) rest.push(singular(w))
    }
    if (quantity === null || quantity < 1 || rest.length === 0) continue
    let best: { p: CatalogItem; s: number } | null = null
    for (const p of catalog) {
      const s = scoreMatch(rest, p)
      if (s > (best?.s ?? 0)) best = { p, s }
    }
    if (best && best.s >= 0.5) {
      const prev = lines.get(best.p._id)
      lines.set(best.p._id, {
        product: best.p,
        quantity: Math.min((prev?.quantity ?? 0) + quantity, 1000),
        confidence: Math.max(prev?.confidence ?? 0, best.s),
      })
    }
  }
  return [...lines.values()]
}

export function matchesKeyword(text: string, keywords: string[]): boolean {
  const clean = ` ${normalize(text)} `
  return keywords.some((k) => {
    const kw = normalize(k)
    return kw.length > 0 && clean.includes(` ${kw} `)
  })
}

/** WhatsApp-formatted price list. */
export function priceListText(
  businessName: string,
  catalog: CatalogItem[],
  currency: string,
): string {
  if (catalog.length === 0) return `Our price list is being updated — a team member will share it shortly.`
  const byCategory = new Map<string, CatalogItem[]>()
  for (const p of catalog) {
    const key = p.category || 'Products'
    byCategory.set(key, [...(byCategory.get(key) ?? []), p])
  }
  const lines: string[] = [`*${businessName} — Price list*`, '']
  for (const [cat, items] of byCategory) {
    if (byCategory.size > 1) lines.push(`_${cat}_`)
    for (const p of items.slice(0, 60)) {
      const soldOut = p.stock !== null && p.stock <= 0
      lines.push(`• ${p.name} — ${formatMoney(p.price, currency)}${p.unit !== 'pcs' ? ` / ${p.unit}` : ''}${soldOut ? ' (sold out)' : ''}`)
    }
    lines.push('')
  }
  lines.push('To order, reply with the quantity and item, e.g. "2 ' + catalog[0].name + '".')
  return lines.join('\n').slice(0, 4000)
}

const PHOTO_WORDS = /\b(pic|pics|picture|pictures|photo|photos|image|images|snap|see it|see them|show me|how e be|how it looks|how does it look)\b/

/** "send me a picture of the lace" → the products the customer wants to SEE. */
export function detectPhotoRequest(text: string, catalog: CatalogItem[]): CatalogItem[] {
  const clean = normalize(text)
  if (!PHOTO_WORDS.test(clean)) return []
  const phrase = tokens(clean).filter((t) => !STOP.has(t))
  return catalog
    .map((p) => ({ p, s: scoreMatch(phrase, p) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.p)
}

/** Fill {name} / {business} placeholders in merchant-written text. */
export function fillPlaceholders(text: string, vars: { name: string; business: string }): string {
  return text.replace(/\{name\}/gi, vars.name).replace(/\{business\}/gi, vars.business)
}
