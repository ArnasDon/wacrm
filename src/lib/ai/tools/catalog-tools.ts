// ============================================================
// Generic Catalog Tools — search_catalog / get_product /
// get_availability / get_product_media.
//
// Per docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
// §4 and docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// ("HERRAMIENTAS DE CATÁLOGO"): these names are fixed and
// provider-agnostic. Budun (or a structured Sheet/CSV data source) is
// selected underneath by the Integration Resolver — the model never
// calls a Budun-named tool.
//
// `executeCatalogTool` is the ToolExecutor the auto-reply/playground
// dispatchers pass into `generateReply`. `accountId` is captured in the
// closure by the caller (see src/lib/ai/auto-reply.ts) — this module
// itself takes it as a plain argument and never reads it from the tool
// call's `input`, so a fabricated `account_id` in the model's tool-call
// arguments has no effect (there's no such argument to fabricate).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolCallRequest, ToolSpec } from '../types'
import { toToolResultProduct } from '../catalog/whitelist'
import * as resolver from '../catalog/resolver'

export const SEARCH_CATALOG = 'search_catalog'
export const GET_PRODUCT = 'get_product'
export const GET_AVAILABILITY = 'get_availability'
export const GET_PRODUCT_MEDIA = 'get_product_media'

export const CATALOG_TOOL_NAMES = [SEARCH_CATALOG, GET_PRODUCT, GET_AVAILABILITY, GET_PRODUCT_MEDIA] as const

/** Default page size when the model doesn't specify `limit` — generous
 *  enough that a plain exploratory query ("qué TVs tienen") already
 *  represents the category fairly, without the model having to think
 *  to raise it. See MAX_SEARCH_LIMIT for the hard cap. */
const DEFAULT_SEARCH_LIMIT = 20
/** Hard cap on `limit`, regardless of what the model requests — keeps
 *  one search_catalog call, and the reply built from it, bounded. Use
 *  `offset` across multiple calls (within MAX_TOOL_TURNS) for a truly
 *  exhaustive listing beyond this. */
const MAX_SEARCH_LIMIT = 50

export const CATALOG_TOOL_SPECS: ToolSpec[] = [
  {
    name: SEARCH_CATALOG,
    description:
      'Busca productos reales en el catálogo del negocio (nombre, marca, modelo o SKU). ' +
      'Úsala SIEMPRE que el cliente pregunte por un producto, precio, color, variante o disponibilidad — ' +
      'nunca respondas esos datos de memoria. ' +
      'Devuelve { products, returned, total, has_more, next_offset }. `total` es cuántos productos coinciden EN ' +
      'TOTAL (puede ser más que los `products` devueltos); `has_more: true` significa que existen más resultados ' +
      'que no están en esta respuesta — en ese caso NUNCA digas que esta es la lista completa. ' +
      'Para una consulta ESPECÍFICA (un producto/variante exacto, p. ej. "A07 negro de 64") deja `limit` por defecto. ' +
      'Para una consulta EXPLORATORIA amplia (p. ej. "qué TVs tienen", "qué marcas hay") sube `limit` (hasta ' +
      `${MAX_SEARCH_LIMIT}) para representar bien la categoría. ` +
      'Para una consulta EXHAUSTIVA ("dame todos", "el listado completo") llama de nuevo con `offset: next_offset` ' +
      'mientras `has_more` sea true, hasta cubrir todo o hasta un límite razonable — si son demasiados resultados, ' +
      'dilo e informa el `total`, no los ocultes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de búsqueda, p. ej. "Samsung S25 256GB".' },
        color: { type: 'string', description: 'Color solicitado, si el cliente lo mencionó.' },
        limit: {
          type: 'number',
          description: `Cuántos productos devolver (por defecto ${DEFAULT_SEARCH_LIMIT}, máximo ${MAX_SEARCH_LIMIT}). Súbelo para consultas exploratorias/exhaustivas.`,
        },
        offset: {
          type: 'number',
          description: 'Cuántos resultados saltar — para continuar una consulta exhaustiva, usa el next_offset de la respuesta anterior.',
        },
        available_only: {
          type: 'boolean',
          description:
            'true para excluir agotados (útil en "qué tienen disponible"). NUNCA lo pongas en true cuando el cliente pregunta por un producto/variante específico — si está agotado, debe poder verse igual para poder decírselo honestamente.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: GET_PRODUCT,
    description:
      'Obtiene el detalle comercial completo de UN producto ya encontrado con search_catalog, usando su id exacto. ' +
      'No inventes un id — usa el id devuelto por search_catalog.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id devuelto por search_catalog.' } },
      required: ['id'],
    },
  },
  {
    name: GET_AVAILABILITY,
    description:
      'Consulta la disponibilidad/stock real y actual de un producto (y por variante/color cuando el ' +
      'catálogo lo soporte), usando el id devuelto por search_catalog o get_product.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id devuelto por search_catalog/get_product.' } },
      required: ['id'],
    },
  },
  {
    name: GET_PRODUCT_MEDIA,
    description:
      'Obtiene la(s) foto(s) comercial(es) reales de un producto, usando el id devuelto por search_catalog o ' +
      'get_product. Llama a esta tool cuando el cliente pida ver una foto.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id devuelto por search_catalog/get_product.' } },
      required: ['id'],
    },
  },
]

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_SEARCH_LIMIT
  return Math.min(Math.max(n, 1), MAX_SEARCH_LIMIT)
}

function nonNegativeInt(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
  return Math.max(n, 0)
}

/**
 * Build the ToolExecutor for the generic catalog tools, scoped to one
 * account. `db` should be the service-role client the auto-reply/
 * playground path already uses — the resolver/providers query
 * `catalog_integrations`/`ai_data_sources`/`ai_catalog_products` with
 * explicit `account_id` filters regardless of which client is passed,
 * same discipline as the rest of the AI pipeline (`loadAiConfig`,
 * `retrieveKnowledge`).
 */
export function executeCatalogTool(db: SupabaseClient, accountId: string) {
  return async function execute(call: ToolCallRequest): Promise<unknown> {
    const input = (call.input ?? {}) as Record<string, unknown>
    try {
      switch (call.name) {
        case SEARCH_CATALOG: {
          const query = str(input.query)
          if (!query.trim()) return { products: [], returned: 0, total: 0, has_more: false }
          const limit = clampLimit(input.limit)
          const offset = nonNegativeInt(input.offset)
          const result = await resolver.searchCatalog(db, accountId, {
            query,
            color: input.color ? str(input.color) : undefined,
            limit,
            offset,
            availableOnly: input.available_only === true,
          })
          return {
            products: result.products.map(toToolResultProduct),
            returned: result.products.length,
            total: result.total,
            has_more: result.hasMore,
            ...(result.hasMore ? { next_offset: offset + result.products.length } : {}),
          }
        }
        case GET_PRODUCT: {
          const id = str(input.id)
          if (!id) return { error: 'id is required' }
          const product = await resolver.getProduct(db, accountId, id)
          if (!product) return { error: 'not_found' }
          return { product: toToolResultProduct(product) }
        }
        case GET_AVAILABILITY: {
          const id = str(input.id)
          if (!id) return { error: 'id is required' }
          const availability = await resolver.getAvailability(db, accountId, id)
          if (!availability) return { error: 'not_found' }
          return availability
        }
        case GET_PRODUCT_MEDIA: {
          const id = str(input.id)
          if (!id) return { error: 'id is required' }
          const media = await resolver.getProductMedia(db, accountId, id)
          if (!media) return { error: 'not_found' }
          if (!media.primaryImage && media.images.length === 0) {
            return { error: 'no_media_available' }
          }
          return media
        }
        default:
          return { error: `unknown tool: ${call.name}` }
      }
    } catch (err) {
      // Infrastructure failure (ERP timeout/5xx, DB error) — surface a
      // safe, generic message to the model. Never forward `err.message`
      // verbatim: a provider HTTP error can embed response fragments we
      // haven't vetted, and this is the boundary the whitelist can't
      // help with (it only covers well-formed catalog payloads).
      console.error(`[catalog tools] ${call.name} failed:`, err instanceof Error ? err.message : err)
      return { error: 'catalog_unavailable' }
    }
  }
}
