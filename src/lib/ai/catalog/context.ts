// ============================================================
// Structured per-conversation catalog context — AI_Catalog_Fix_Kit
// FASE 6.
//
// THE BUG THIS FIXES: the tool-calling loop (providers/openai-
// compatible.ts, providers/anthropic.ts) resolves products WITHIN one
// generateReply() call, but its tool_calls/tool_results are ephemeral
// — discarded once that call returns text. The next turn only sees the
// PROSE the model wrote, not the structured product/id it resolved. If
// the customer's follow-up ("¿y el morado?") doesn't repeat enough
// detail for the model to re-derive the right product from its own
// prior sentence, it truthfully has nothing to search with and falls
// back to "no tengo información confirmada" — even though the agent
// "knew" the product one turn ago. This module makes that knowledge
// durable across turns, in structured form, WITHOUT letting it become
// a second, stale source of price/stock truth: the prompt section it
// produces (`catalogContextToPromptText`) explicitly instructs the
// model to treat it as disambiguation-only and re-call the tools
// before answering — the "no invented prices" guarantee still lives
// entirely in the tool layer (see catalog/whitelist.ts, tools/
// catalog-tools.ts), not here.
//
// Callers:
//   - src/lib/ai/auto-reply.ts persists this on `conversations.
//     ai_catalog_context` (migration 045) — real conversations have a
//     stable conversationId to key off.
//   - src/app/api/ai/playground/route.ts has no conversationId (the
//     client resends the full transcript each call), so it accepts/
//     returns this object in the request/response body instead; the
//     Playground UI (ai-playground.tsx) holds it in React state and
//     resends it — closing the exact gap that produced the reported
//     "showed a product, then said no info" discontinuity.
// ============================================================

import type { ToolCallLogEntry } from '../types'
import { GET_PRODUCT, SEARCH_CATALOG } from '../tools/catalog-tools'

export interface CatalogContextProduct {
  id: string
  name: string
  brand: string | null
  model: string | null
  color: string | null
  capacity: string | null
  size: string | null
  price: number | null
  currency: string | null
}

export interface CatalogTurnContext {
  /** Most recent non-empty search_catalog query — the "family" hint
   *  for an implicit follow-up like "¿y el morado?". */
  lastQuery: string | null
  /** Most-recently-seen-first, capped. Never the sole source of a
   *  price/stock answer — see the module doc above. */
  products: CatalogContextProduct[]
  updatedAt: string
}

const MAX_CONTEXT_PRODUCTS = 20

function toContextProduct(p: {
  id: string
  name: string
  brand: string | null
  model: string | null
  colors?: string[]
  capacity: string | null
  size: string | null
  price: number | null
  currency: string | null
}): CatalogContextProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    model: p.model,
    color: p.colors && p.colors.length > 0 ? p.colors[0] : null,
    capacity: p.capacity,
    size: p.size,
    price: p.price,
    currency: p.currency,
  }
}

/**
 * Fold this turn's tool calls into the running context. `search_catalog`
 * results replace `lastQuery` and upsert every returned product;
 * `get_product` upserts the one product it resolved. Everything else
 * (get_availability/get_product_media) is intentionally NOT folded in
 * here — those return partial data (availability/media only), and
 * writing a partial record into the product list would let a later
 * turn read a stale/incomplete `price` for that id.
 */
export function updateCatalogContext(
  previous: CatalogTurnContext | null,
  toolCalls: ToolCallLogEntry[],
): CatalogTurnContext {
  const merged = new Map<string, CatalogContextProduct>()
  let lastQuery = previous?.lastQuery ?? null

  for (const call of toolCalls) {
    if (call.name === SEARCH_CATALOG) {
      const input = call.input as { query?: unknown } | null
      if (input && typeof input.query === 'string' && input.query.trim()) {
        lastQuery = input.query.trim()
      }
      const result = call.result as { products?: unknown[] } | null
      if (result && Array.isArray(result.products)) {
        for (const raw of result.products) {
          const p = raw as Parameters<typeof toContextProduct>[0]
          if (p && typeof p.id === 'string') merged.set(p.id, toContextProduct(p))
        }
      }
    } else if (call.name === GET_PRODUCT) {
      const result = call.result as { product?: unknown } | null
      const p = result?.product as Parameters<typeof toContextProduct>[0] | undefined
      if (p && typeof p.id === 'string') merged.set(p.id, toContextProduct(p))
    }
  }

  // New/updated entries win; previously-known products not touched
  // this turn are kept (so "el morado" from two turns ago is still
  // resolvable), appended after this turn's, capped.
  if (previous) {
    for (const p of previous.products) {
      if (!merged.has(p.id)) merged.set(p.id, p)
    }
  }

  return {
    lastQuery,
    products: Array.from(merged.values()).slice(0, MAX_CONTEXT_PRODUCTS),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Render the context as a system-prompt section. Returns null for an
 * empty/absent context so callers can omit the section entirely (no
 * prompt bloat for a conversation that's never touched the catalog).
 */
export function catalogContextToPromptText(context: CatalogTurnContext | null | undefined): string | null {
  if (!context || context.products.length === 0) return null

  const lines = context.products.map((p) => {
    const attrs = [p.brand, p.model, p.color, p.capacity, p.size].filter(Boolean).join(' ')
    const price = p.price !== null ? `${p.price}${p.currency ? ' ' + p.currency : ''}` : 'sin precio registrado'
    return `- id="${p.id}" ${p.name}${attrs ? ` (${attrs})` : ''} — último precio visto: ${price}`
  })

  return (
    'CONTEXTO DE CATÁLOGO DE TURNOS ANTERIORES (solo para identificar a qué producto/variante se refiere el ' +
    'cliente en un mensaje corto como "el negro de 64" o "¿y el morado?" — usa el historial de la conversación ' +
    'junto con esta lista para resolver la referencia). ' +
    'NUNCA respondas un precio o stock usando solo estos valores: son de un turno anterior y pueden estar ' +
    'desactualizados — vuelve a llamar a get_product/get_availability con el id correcto antes de confirmar ' +
    'cualquier precio, stock o disponibilidad.\n' +
    (context.lastQuery ? `Última búsqueda: "${context.lastQuery}"\n` : '') +
    lines.join('\n')
  )
}
