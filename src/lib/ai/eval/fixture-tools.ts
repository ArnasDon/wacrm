import type { AgentToolCall, AgentToolDefinition, AgentToolExecutor } from '../types'

/**
 * Fictional catalogue + knowledge base + tool set for integration-style
 * evals. Mirrors the shape of the real tools in `../tools/index.ts`
 * (same names/parameters, so a prompt tuned against this fixture behaves
 * the same against production) but never touches Supabase, WhatsApp, or
 * a real provider bill beyond the model call itself — per the eval
 * README's rule that integration tests must use fictional data.
 *
 * The point of this module: the default golden set and personas never
 * exercise tool-calling at all (no tools are wired in), so a prompt
 * regression in *which tool the agent reaches for* — the exact
 * complaint that motivated this file — was invisible to `npm run
 * eval:agent` before. `recordedCalls()` exposes exactly what was
 * called, in order, so a case's criteria can assert on tool decisions,
 * not just the final text.
 */

export interface FixtureProduct {
  productRef: string
  name: string
  color: string
  description: string
  price: number
  currency: string
  imageUrl: string
  stockQuantity: number
}

export const FIXTURE_CATALOG: FixtureProduct[] = [
  {
    productRef: 'fx-legging-preta',
    name: 'Legging Alta Performance',
    color: 'Preta',
    description: 'Cintura alta, tecido flexível, cobertura total, ideal para treino intenso.',
    price: 1500,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/legging-preta.jpg',
    stockQuantity: 12,
  },
  {
    productRef: 'fx-legging-branca',
    name: 'Legging Alta Performance',
    color: 'Branca',
    description: 'Cintura alta, tecido flexível, cobertura total, ideal para treino intenso.',
    price: 1500,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/legging-branca.jpg',
    stockQuantity: 12,
  },
  {
    productRef: 'fx-top-alcas',
    name: 'Top Alças Duplas',
    color: 'Azul-claro',
    description: 'Alças finas cruzadas, decote discreto, tecido respirável.',
    price: 1500,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/top-alcas.jpg',
    stockQuantity: 12,
  },
  {
    productRef: 'fx-camiseta-costurada',
    name: 'Camiseta Costurada',
    color: 'Preta',
    description: 'Corte solto, mais reservada, costuras reforçadas, cobertura total.',
    price: 2000,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/camiseta-costurada.jpg',
    stockQuantity: 12,
  },
  {
    productRef: 'fx-lacos',
    name: 'Laços da LC',
    color: 'Azul-claro',
    description: 'Acessório de cabelo a condizer com a coleção.',
    price: 500,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/lacos.jpg',
    stockQuantity: 12,
  },
  {
    productRef: 'fx-conjunto-esgotado',
    name: 'Conjunto Fitness Premium',
    color: 'Preta',
    description: 'Top e calça a condizer, edição limitada.',
    price: 2500,
    currency: 'MZN',
    imageUrl: 'https://fixture.local/conjunto-esgotado.jpg',
    stockQuantity: 0,
  },
]

export const FIXTURE_KNOWLEDGE: Record<string, string> = {
  horario: 'Segunda a sexta: 9h-18h30. Sábado: 9h-14h. Domingo: encerrado.',
  localizacao: 'Avenida Agostinho Neto, esquina com Olof Palme, Prédio n.º 868, 1.º andar, Maputo.',
  entrega: 'Entrega na cidade de Maputo a partir de 300 MT, consoante a localização.',
  devolucao: 'Trocas/devoluções dentro de 7 dias, peça em bom estado, com etiqueta.',
}

export interface RecordedToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** Tool JSON-schemas copied from `../tools/index.ts` — kept in sync by
 *  hand since the real ones are not exported; a name/shape drift here
 *  would fail loudly (the model would call an unknown tool) rather than
 *  silently, so this is safe to maintain separately. */
const FIXTURE_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'search_catalog',
    description:
      'Search all active product catalogues. Returns real names, prices, photos, colours and a temporary product_ref. Never reproduce results as a numbered text list.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Product name, category, colour, size or customer need.' },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_product',
    description: 'Send one product photo already found by search_catalog, using its exact product_ref.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { product_ref: { type: 'string' } },
      required: ['product_ref'],
    },
  },
  {
    name: 'get_style_opinion',
    description:
      'Get an honest opinion on how well specific catalogue products suit what the customer said about their own body, height, or style preference.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        product_refs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
        customer_description: { type: 'string' },
      },
      required: ['product_refs', 'customer_description'],
    },
  },
  {
    name: 'schedule_visit',
    description: 'Book a date and time for the customer to visit the physical store.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scheduled_at: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['scheduled_at'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the company knowledge base for services, policies or factual information.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'handoff_human',
    description: 'Stop automatic replies and route the current conversation to a human.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { reason: { type: 'string' }, summary: { type: 'string' } },
      required: ['reason'],
    },
  },
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Builds a fresh fixture tool set. Call once per eval case/turn-loop so
 *  `recordedCalls()` reflects only that run. */
export function createFixtureTools(): {
  tools: AgentToolDefinition[]
  executeTool: AgentToolExecutor
  recordedCalls: () => RecordedToolCall[]
} {
  const calls: RecordedToolCall[] = []

  const executeTool: AgentToolExecutor = async (call: AgentToolCall) => {
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
    calls.push({ name: call.name, arguments: args })

    switch (call.name) {
      case 'search_catalog': {
        const query = normalize(String(args.query ?? ''))
        const matches = FIXTURE_CATALOG.filter(
          (p) =>
            normalize(p.name).includes(query) ||
            normalize(p.color).includes(query) ||
            normalize(p.description).includes(query) ||
            query.split(' ').some((word) => word.length > 2 && normalize(p.name).includes(word)),
        )
        return JSON.stringify({
          ok: true,
          products: matches.map((p) => ({
            product_ref: p.productRef,
            name: p.name,
            color: p.color,
            price: p.price,
            currency: p.currency,
            stockQuantity: p.stockQuantity,
          })),
          found: matches.length > 0,
        })
      }
      case 'send_product': {
        const ref = String(args.product_ref ?? '')
        const product = FIXTURE_CATALOG.find((p) => p.productRef === ref)
        return JSON.stringify({ ok: Boolean(product), sent: Boolean(product) })
      }
      case 'get_style_opinion': {
        const refs = Array.isArray(args.product_refs) ? (args.product_refs as string[]) : []
        const opinion = refs
          .map((ref) => FIXTURE_CATALOG.find((p) => p.productRef === ref))
          .filter((p): p is FixtureProduct => Boolean(p))
          .map((p) => `${p.name} (${p.color}): combina bem, corte confortável.`)
          .join(' ')
        return JSON.stringify({ ok: true, opinion: opinion || 'Nenhum produto reconhecido.' })
      }
      case 'schedule_visit': {
        return JSON.stringify({ ok: true, scheduled: true, scheduled_at: args.scheduled_at })
      }
      case 'search_knowledge': {
        const query = normalize(String(args.query ?? ''))
        const matches = Object.entries(FIXTURE_KNOWLEDGE)
          .filter(([key, value]) => normalize(key).includes(query) || normalize(value).includes(query))
          .map(([, value]) => value)
        return JSON.stringify({ ok: true, matches, found: matches.length > 0 })
      }
      case 'handoff_human': {
        return JSON.stringify({ ok: true, handoff_requested: true })
      }
      default:
        throw new Error(`Unknown fixture tool: ${call.name}`)
    }
  }

  return { tools: FIXTURE_TOOL_DEFINITIONS, executeTool, recordedCalls: () => calls }
}
