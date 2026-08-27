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

export const CATALOG_TOOL_SPECS: ToolSpec[] = [
  {
    name: SEARCH_CATALOG,
    description:
      'Busca productos reales en el catálogo del negocio (nombre, marca, modelo o SKU). ' +
      'Úsala SIEMPRE que el cliente pregunte por un producto, precio, color, variante o disponibilidad — ' +
      'nunca respondas esos datos de memoria. Devuelve una lista de productos con su id, precio y stock reales.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de búsqueda, p. ej. "Samsung S25 256GB".' },
        color: { type: 'string', description: 'Color solicitado, si el cliente lo mencionó.' },
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
          if (!query.trim()) return { products: [] }
          const products = await resolver.searchCatalog(db, accountId, {
            query,
            color: input.color ? str(input.color) : undefined,
            limit: 8,
          })
          return { products: products.map(toToolResultProduct) }
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
