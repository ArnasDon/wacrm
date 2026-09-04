// ============================================================
// Routing — AI optimization project, FASE 5.
//
// A cheap, local, deterministic classifier that runs BEFORE
// buildSystemPrompt()/retrieveKnowledge() to decide which of the two
// expensive resources (Knowledge retrieval, catalog tools) a turn
// probably needs. It never talks to a model, a provider, or the
// network — pure string matching against the message text plus the
// caller-supplied account capability flags and cross-turn catalog
// context.
//
// WHAT THIS DOES NOT DO (by design):
//   - It never decides what the model is ALLOWED to say — that
//     guarantee lives entirely in the tool layer (whitelist.ts,
//     catalog ids) and the system prompt's own rules, unchanged by
//     this file.
//   - It never replaces search_catalog / retrieveKnowledge — it only
//     decides whether the caller attempts them THIS turn.
//   - It is not a second search engine: catalog/normalize.ts's
//     tolerant token matching stays exactly what search_catalog uses
//     internally: this module only recognizes generic COMMERCE/
//     BUSINESS-INFO vocabulary ("cuánto cuesta", "horario", "en
//     negro", "delivery", …), never product/brand names, so the same
//     module works unmodified for a phone store, a hardware store, a
//     restaurant, or a hair salon.
//
// CONSERVATIVE BY CONSTRUCTION: any signal from BOTH sides → 'both'.
// No signal from either side and the message isn't a clear greeting/
// acknowledgement → 'both' too, whenever both resources are actually
// available (see routeAiContext's doc for the exact decision table).
// The one case that can EVER end up narrower than 'both' is a genuine
// signal for exactly one side with none for the other — never a
// guess born purely of absence of information.
// ============================================================

/** Four-way classification — mirrors the CHECK constraint on
 *  ai_usage_log.routing_decision (migration 049). The single source of
 *  truth for this union; usage.ts imports it from here. */
export type RoutingDecision = 'catalog' | 'knowledge' | 'both' | 'neither'

export interface RouteAiContextArgs {
  /** The customer's latest message (same text retrieveKnowledge() and
   *  the catalog tools would be pointed at). */
  message: string
  /** Whether this account has at least one active catalog source
   *  (hasActiveCatalogSources()). When false, catalog can never be
   *  chosen — there is nothing to attach. */
  hasCatalog: boolean
  /** Whether this account has any Knowledge Base content
   *  (accountHasKnowledgeBase()). When false, Knowledge can never be
   *  chosen — there is nothing to retrieve. */
  hasKnowledge: boolean
  /** True when the conversation has resolved/seen real catalog
   *  products recently (ai_catalog_context.products non-empty, or the
   *  Playground's client-resent equivalent). A short follow-up like
   *  "¿y en negro?" or "¿cuál recomiendas?" carries no catalog
   *  vocabulary of its own — this is what keeps routing from dropping
   *  catalog on exactly the turns that most need it. Defaults to
   *  false. */
  catalogContextActive?: boolean
}

export interface RouteAiContextResult {
  /** What the message/context signaled — always one of the four
   *  labels, independent of whether the resource was actually
   *  available (see useCatalog/useKnowledge for the realized effect).
   *  Written verbatim to ai_usage_log.routing_decision. */
  decision: RoutingDecision
  /** Whether the caller should actually attach catalog tools this
   *  turn — already clamped to `hasCatalog`. */
  useCatalog: boolean
  /** Whether the caller should actually call retrieveKnowledge() this
   *  turn — already clamped to `hasKnowledge`. */
  useKnowledge: boolean
}

// ------------------------------------------------------------
// Vocabulary — deliberately generic. Every entry is a commerce/
// business-info WORD OR PHRASE, never a product category, brand, or
// model ("Samsung", "iPhone", "TV", "laptop" appear nowhere below).
// Written accent-free / lowercase to match normalizeMessage()'s output.
//
// Spanish first (this codebase's primary market — see defaults.ts's
// America/Santo_Domingo default timezone), with a modest English
// supplement: buildSystemPrompt()'s own hard rule is to answer in
// WHATEVER language the customer writes in, so a router that only
// recognized Spanish would systematically under-attach catalog/
// Knowledge for every English-speaking customer — a real instance of
// the "falso no tengo información" the REGLA PRINCIPAL forbids, not a
// cosmetic gap. Not an attempt at full multilingual coverage: two
// languages, matched the same conservative way.
// ------------------------------------------------------------

/** Generic attributes and transactional vocabulary — works for a
 *  phone, a hammer, a haircut slot, or a pizza equally. */
const CATALOG_WORDS = [
  // Spanish
  'marca', 'modelo', 'sku', 'precio', 'precios', 'costo', 'cuesta', 'cuestan',
  'vale', 'valen', 'sale', 'salen', 'stock', 'disponibilidad', 'disponible',
  'disponibles', 'cantidad', 'color', 'colores', 'variante', 'variantes',
  'capacidad', 'tamano', 'tamanos', 'talla', 'tallas', 'pulgada', 'pulgadas',
  'memoria', 'ram', 'almacenamiento', 'tienen', 'tiene', 'hay', 'venden',
  'vende', 'manejan', 'maneja', 'queda', 'quedan',
  // English
  'brand', 'model', 'price', 'prices', 'cost', 'costs', 'available',
  'availability', 'quantity', 'colour', 'colors', 'colours',
  'variant', 'variants', 'capacity', 'size', 'sizes', 'inch', 'inches',
  'memory', 'storage', 'have', 'has', 'sell', 'sells', 'left',
]

const CATALOG_PHRASES = [
  // Spanish
  'cuanto cuesta', 'cuanto vale', 'cuanto sale', 'cuantos quedan', 'cuantas quedan',
  'en negro', 'en blanco', 'en azul', 'en rojo', 'en verde', 'en gris',
  'en dorado', 'en plateado', 'en rosado', 'en beige', 'en morado',
  'que modelos', 'que colores', 'que tallas', 'que tamanos', 'que precios',
  'que opciones', 'que marcas',
  // English
  'how much', 'how much does it cost', 'how much is', 'how many left',
  'how many are left', 'in black', 'in white', 'in blue', 'in red',
  'in green', 'in gray', 'in grey', 'what models', 'what colors',
  'what sizes', 'what options', 'what brands', 'do you have', 'do you sell',
  'have got',
]

/** Generic "qué <categoría> tienen/hay/manejan/venden" (and its English
 *  "what <category> do you have" equivalent) — this is what lets "qué
 *  televisores tienen" (electronics), "qué platos tienen" (restaurant)
 *  and "what wrenches do you sell" (hardware store) all match through
 *  ONE pair of patterns instead of a growing list of category nouns.
 *  Runs against the accent-stripped, lowercased message. */
const CATALOG_CATEGORY_QUESTIONS = [
  /\bque\s+[a-z0-9]+(?:\s+[a-z0-9]+){0,2}\s+(tienen|tiene|manejan|maneja|hay|venden|vende|ofrecen|ofrece)\b/,
  /\bwhat\s+[a-z0-9]+(?:\s+[a-z0-9]+){0,2}\s+(do you have|does it have|are available|do you sell|do you offer)\b/,
]

const KNOWLEDGE_WORDS = [
  // Spanish
  'horario', 'horarios', 'ubicacion', 'direccion', 'delivery', 'entrega',
  'envio', 'envios', 'zona', 'zonas', 'garantia', 'garantias', 'devolucion',
  'devoluciones', 'cambio', 'cambios', 'politica', 'politicas', 'contacto',
  'telefono', 'whatsapp', 'correo', 'email', 'financiamiento',
  // English
  'hours', 'location', 'address', 'shipping', 'delivery', 'zone', 'zones',
  'warranty', 'return', 'returns', 'refund', 'refunds', 'policy', 'policies',
  'contact', 'phone', 'payment', 'payments', 'financing',
]

const KNOWLEDGE_PHRASES = [
  // Spanish
  'donde estan', 'donde queda', 'donde quedan', 'como llego', 'como llegar',
  'zonas de cobertura', 'metodo de pago', 'metodos de pago', 'forma de pago',
  'formas de pago', 'aceptan tarjeta', 'aceptan efectivo', 'aceptan transferencia',
  'informacion general', 'informacion del negocio', 'redes sociales',
  'a que hora', 'hasta que hora', 'cuando abren', 'cuando cierran',
  'estan abiertos', 'estan cerrados', 'facilidades de pago', 'hacen envios',
  'hacen delivery', 'hacen entregas',
  // English
  'where are you located', 'where are you', 'how do i get there',
  'coverage area', 'payment methods', 'do you accept card', 'do you accept cash',
  'do you take card', 'general information', 'social media', 'what time',
  'when do you open', 'when do you close', 'are you open', 'do you ship',
  'do you deliver', 'return policy',
]

/** Short, exact-ish greetings/acknowledgements — deliberately narrow.
 *  Anything NOT confidently one of these falls through to the
 *  conservative "both, when both are available" branch rather than
 *  being guessed as a greeting. */
const GREETING_ACK_PHRASES = new Set([
  'hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia',
  'gracias', 'muchas gracias', 'mil gracias', 'te lo agradezco',
  'ok', 'okay', 'oki', 'vale', 'perfecto', 'genial', 'excelente', 'listo',
  'de acuerdo', 'entendido', 'claro', 'esta bien', 'super',
  'hi', 'hello', 'hey', 'thanks', 'thank you', 'good morning',
  'good afternoon', 'good evening', 'bye', 'adios', 'chao', 'nos vemos',
])

/** Lowercase, strip diacritics/punctuation, collapse whitespace — the
 *  same normalization catalog/normalize.ts uses for product matching,
 *  reimplemented minimally here (not imported) so this module never
 *  pulls in normalize.ts's product-ranking machinery — routing must
 *  stay a plain classifier, never a second search engine. */
function normalizeMessage(raw: string): string {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  s = s.replace(/[¿?¡!.,;:()"'“”]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function matchesAny(normalized: string, entries: string[]): boolean {
  return entries.some((entry) => normalized.includes(entry))
}

/** True for `entries` that are single words — checked with a word
 *  boundary so "hay" doesn't match inside "ensayo", "sku" doesn't
 *  match inside a longer alphanumeric token, etc. Phrases (multiple
 *  words) are checked as plain substrings via matchesAny instead,
 *  since normalizeMessage already collapsed whitespace consistently
 *  and a multi-word phrase is specific enough on its own. */
function matchesAnyWord(normalized: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`).test(normalized))
}

function hasCatalogSignal(normalized: string): boolean {
  return (
    matchesAnyWord(normalized, CATALOG_WORDS) ||
    matchesAny(normalized, CATALOG_PHRASES) ||
    CATALOG_CATEGORY_QUESTIONS.some((pattern) => pattern.test(normalized))
  )
}

function hasKnowledgeSignal(normalized: string): boolean {
  return matchesAnyWord(normalized, KNOWLEDGE_WORDS) || matchesAny(normalized, KNOWLEDGE_PHRASES)
}

function isGreetingOrAck(normalized: string): boolean {
  return GREETING_ACK_PHRASES.has(normalized)
}

/**
 * Decide which of Knowledge/catalog a turn probably needs, without a
 * model call, a network request, or any I/O — see the module doc for
 * the full set of guarantees. Decision table (conservative-first):
 *
 *   neither available                          → neither
 *   catalog signal AND knowledge signal         → both  (clamped)
 *   catalog signal only                         → catalog (clamped)
 *   knowledge signal only                       → knowledge (clamped)
 *   no signal, message is a clear greeting/ack  → neither
 *   no signal, otherwise ambiguous              → both when both
 *                                                  available, else
 *                                                  whichever ONE
 *                                                  resource exists
 *
 * `catalogContextActive` folds into the catalog signal on its own —
 * a content-free follow-up ("¿y ese?", "¿cuál recomiendas?") right
 * after the model resolved real products keeps routing toward catalog
 * even though the follow-up itself contains no catalog vocabulary.
 */
export function routeAiContext(args: RouteAiContextArgs): RouteAiContextResult {
  const { message, hasCatalog, hasKnowledge, catalogContextActive = false } = args

  if (!hasCatalog && !hasKnowledge) {
    return { decision: 'neither', useCatalog: false, useKnowledge: false }
  }

  const normalized = normalizeMessage(message)
  const catalogSignal = hasCatalog && (hasCatalogSignal(normalized) || catalogContextActive)
  const knowledgeSignal = hasKnowledge && hasKnowledgeSignal(normalized)

  if (catalogSignal && knowledgeSignal) {
    return { decision: 'both', useCatalog: true, useKnowledge: true }
  }
  if (catalogSignal) {
    return { decision: 'catalog', useCatalog: true, useKnowledge: false }
  }
  if (knowledgeSignal) {
    return { decision: 'knowledge', useCatalog: false, useKnowledge: true }
  }

  if (isGreetingOrAck(normalized)) {
    return { decision: 'neither', useCatalog: false, useKnowledge: false }
  }

  // No specific signal either way, and not a clear greeting/ack —
  // REGLA PRINCIPAL: when in doubt, include everything that's
  // actually available, never guess narrower.
  if (hasCatalog && hasKnowledge) {
    return { decision: 'both', useCatalog: true, useKnowledge: true }
  }
  return hasCatalog
    ? { decision: 'catalog', useCatalog: true, useKnowledge: false }
    : { decision: 'knowledge', useCatalog: false, useKnowledge: true }
}
