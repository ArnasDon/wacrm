// ============================================================
// Pure helpers deciding which images the hotel bot sends on its own —
// the media side of the flow is code-driven because the model does not
// reliably emit its send markers (see auto-reply.ts's banner comment).
//
//  - `productAskedAbout`: the ONE catalog item a guest's message points
//    at ("¿tiene fotos de la habitación deluxe?" → "Suite Master
//    Deluxe"), or null when it's ambiguous or absent — never a guess
//    between several.
//  - `isPhotoPromise`: whether the bot's own reply text actually PROMISES
//    a photo ("le comparto la foto de…"), as opposed to a conditional
//    offer or a question ("si me confirma, le envío la foto").
// ============================================================

/** Words shared by many items (room/package/service vocabulary, tiers,
 *  stop words) — never enough on their own to identify one product. */
const GENERIC_TOKENS = new Set([
  'suite', 'suites', 'habitacion', 'habitaciones', 'cuarto', 'cuartos', 'room',
  'paquete', 'paquetes', 'package', 'masaje', 'masajes', 'spa', 'tour', 'tours',
  'actividad', 'actividades', 'evento', 'eventos', 'salon', 'plan', 'planes',
  'noche', 'noches', 'persona', 'personas', 'pareja', 'parejas', 'individual',
  'doble', 'sencilla', 'triple', 'cuadruple', 'familiar', 'estandar', 'standard',
  'para', 'con', 'sin', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas',
  'the', 'and', 'incluye', 'servicio', 'servicios', 'opcion', 'tipo',
])

/** Lowercase, accents stripped, parenthesized notes dropped, punctuation → spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const tokensOf = (text: string) => normalizeForMatch(text).split(' ').filter(Boolean)

/**
 * The single product a guest's message names or clearly points at, or
 * null. Full-name mentions win (the longest one, so "Suite Master
 * Deluxe" beats "Suite Deluxe" when both are present); otherwise a
 * distinctive word ("deluxe", "romántico") that belongs to exactly one
 * product. Two or more candidates → null (the bot asks which one).
 */
export function productAskedAbout(
  message: string,
  productNames: readonly string[],
  /** The business's own name: its words never identify a product on
   *  their own ("Paquete San Ricardo" vs. "Hotel San Ricardo"). */
  businessName?: string | null,
): string | null {
  const ignored = new Set(tokensOf(businessName ?? ''))
  const text = ` ${normalizeForMatch(message)} `
  if (!text.trim()) return null

  const byName = productNames
    .map((name) => ({ name, norm: normalizeForMatch(name) }))
    .filter((p) => p.norm.length >= 4)

  const full = byName.filter((p) => text.includes(` ${p.norm} `))
  if (full.length > 0) {
    const longest = Math.max(...full.map((p) => p.norm.length))
    const top = full.filter((p) => p.norm.length === longest)
    // A shorter full match contained in the longest one is the same mention.
    const distinct = full.filter((p) => !top.some((t) => t !== p && t.norm.includes(p.norm)))
    if (top.length !== 1 || distinct.length !== 1) return null
    // A more specific variant with the same name start ("Suite Clásica"
    // vs. "Suite Clásica Doble") that the guest did NOT name → ambiguous.
    const hasUnnamedVariant = byName.some(
      (p) => p !== top[0] && p.norm.startsWith(`${top[0].norm} `) && !text.includes(` ${p.norm} `),
    )
    return hasUnnamedVariant ? null : top[0].name
  }

  // Distinctive words: in exactly one product's name, and not generic.
  const owners = new Map<string, Set<string>>()
  for (const p of byName) {
    for (const token of new Set(tokensOf(p.name))) {
      if (token.length < 4 || GENERIC_TOKENS.has(token) || ignored.has(token) || /^\d+$/.test(token)) continue
      const set = owners.get(token) ?? new Set<string>()
      set.add(p.name)
      owners.set(token, set)
    }
  }
  const hits = new Set<string>()
  for (const token of new Set(tokensOf(message))) {
    const set = owners.get(token)
    if (set && set.size === 1) hits.add([...set][0])
  }
  return hits.size === 1 ? [...hits][0] : null
}

const PROMISE_RE =
  /\b(comparto|env[ií]o|le env[ií]o|aqu[ií]\s+tiene|aqu[ií]\s+est[aá]|le dejo)\b[^.!?\n]{0,25}\b(foto|imagen|fotograf[ií]a)/i
/** "si me confirma", "si gusta", "si lo desea", "cuando me confirme"… */
const CONDITIONAL_RE =
  /\b(si\s+(me\s+)?(confirma|gusta|desea|lo\s+desea|quiere|prefiere|le\s+parece|le\s+interesa)|cuando\s+me\s+(confirme|diga|indique)|en\s+cuanto\s+me\s+confirme)\b/i

/**
 * True only when some sentence of `reply` promises a photo outright.
 * A sentence that asks something ("¿le envío la foto?") or makes the
 * photo conditional ("si me confirma, le envío la foto") is an offer,
 * not a promise — sending the photo anyway contradicts the text the
 * guest just read (real incident 2026-09-24, Villa San Ricardo).
 */
export function isPhotoPromise(reply: string): boolean {
  const sentences = reply.match(/[^.!?\n]*[.!?\n]?/g) ?? []
  return sentences.some((sentence) => {
    if (!PROMISE_RE.test(sentence)) return false
    if (sentence.trim().endsWith('?') || sentence.includes('¿')) return false
    return !CONDITIONAL_RE.test(sentence)
  })
}

/** "¿dónde quedan?", "donde kedan", "ubicación", "cómo llego", "mapa",
 *  "where are you located"… — accents already stripped by `normalizeForMatch`. */
const LOCATION_RE =
  /\b(ubicacion|ubicados?|ubicadas?|donde (estan|esta|quedan|queda|kedan|keda|se ubican|se encuentran)|como (llego|llegar|llegamos)|direccion|mapa|maps|waze|location|located|address|where are you|directions)\b/

/**
 * True when the guest is asking where the business is. Real case, test
 * run 2026-09-24 (B42): "donde kedan, aseptan perritos" got the Rooms
 * banner because the reply named two suites while answering the pets
 * part — the guest wanted the map, not a room gallery.
 */
export function isLocationQuestion(message: string | null | undefined): boolean {
  return LOCATION_RE.test(normalizeForMatch(message ?? ''))
}

/**
 * Whether the bot's reply names this catalog item. A one-word name (the
 * "Romántico" / "Relajante" left after stripping "Paquete" / "Masaje")
 * doubles as an ordinary adjective, so it only counts written as a proper
 * noun — QA 2026-10-01: "más especial y romántico" sent the Paquetes
 * banner to a guest choosing between two suites.
 */
export function replyNamesProduct(reply: string, name: string): boolean {
  if (/\s/.test(name.trim())) return reply.toLowerCase().includes(name.toLowerCase())
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}])${escaped}(?![\\p{L}])`, 'u').test(reply)
}

const MAPS_URL_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|waze\.com)\/?[^\s)"'<>]*/i

/** The first Google Maps / Waze link in `text` (the account's own
 *  prompt), or null. */
export function mapsLinkIn(text: string | null | undefined): string | null {
  const match = (text ?? '').match(MAPS_URL_RE)
  return match ? match[0].replace(/[.,;:!?]+$/, '') : null
}

/** Health / safety wording (accents already stripped). */
const MEDICAL_RE =
  /\b(embarazad[ao]s?|embarazo|pregnan\w*|alergi\w*|alergic\w*|medic[oa]s?|doctor|doctora|presion|diabet\w*|cirugia|operad[ao]|lesion|lesionad[ao]|hernia|varices|trombosis|epilepsia|marcapasos|condicion medica|contraindicad\w*|es seguro|seguro para mi)\b/

/**
 * True when this turn is about a health condition or safety concern
 * ("¿es segura la reflexología a los 6 meses de embarazo?") — on either
 * side: the guest's question or the bot's "consúltelo con su médico"
 * answer. A canned "¿Le gustaría reservarla?" right after a medical
 * caution reads as pushing the sale over the guest's health (test run
 * 2026-09-24, B44), so the post-photo booking nudge is skipped then.
 */
export function isMedicalCaution(inbound: string | null | undefined, reply?: string | null): boolean {
  return MEDICAL_RE.test(normalizeForMatch(inbound ?? '')) || MEDICAL_RE.test(normalizeForMatch(reply ?? ''))
}

/** Payment / deposit asks (accents already stripped). */
const PAYMENT_RE =
  /\b(numero de cuenta|cuenta (bancaria|de banco|monetaria)|datos (bancarios|de pago|para (el )?(pago|deposito|anticipo))|como (pago|puedo pagar|le pago|hago el pago|deposito)|donde (pago|deposito)|forma de pago|formas de pago|metodos? de pago|pagar con tarjeta|link de pago|enlace de pago|transferencia|hacer el deposito|depositar|pagar el anticipo|pago del anticipo|bank account|payment|pay the deposit|how (do|can) i pay)\b/

/**
 * True when the guest wants to PAY (bank account, deposit, card, link).
 * The bot never handles money, so this is the moment to offer an advisor
 * — the test run's guest asked for the account number for her deposit
 * and the bot just said the team would send it (2026-09-24, B8).
 */
export function isPaymentRequest(message: string | null | undefined): boolean {
  return PAYMENT_RE.test(normalizeForMatch(message ?? ''))
}

/** Step 1 of the two-step handoff protocol, worded for a payment ask. */
export const PAYMENT_HANDOFF_OFFER =
  '¿Desea que le comunique con un asesor de nuestro equipo para coordinar el pago? 😊'
export const PAYMENT_HANDOFF_OFFER_EN =
  'Would you like me to connect you with a team member to arrange the payment? 😊'

/** "¿tiene fotos?", "mándeme imágenes", "¿cómo es la suite?", "quiero
 *  verla", "pics / photos / pictures" (accents already stripped). */
const PHOTO_REQUEST_RE =
  /\b(fotos?|fotografias?|imagen(es)?|pics?|photos?|pictures?|images?|video|videos|como (es|son|se ve|se ven|luce|lucen)|(ver (la|el|las|los|como)|verla|verlo|verlas|verlos|mirarla|mirarlo)|muestra|muestran|muestre|muestrame|muestreme|mostrar(me|nos)?|ensene|ensename|enseneme|what (does|do) .* look like|see (it|them|the))\b/

/**
 * True when the guest asks to SEE something. Hotel item photos go out
 * only then — naming a room while booking it ("quiero 2 Suite Premium
 * del 24 al 26") is not a request for its gallery (owner, 2026-09-24:
 * four photos arrived "de golpe" on a plain booking message).
 */
export function guestAskedForPhotos(message: string | null | undefined): boolean {
  return PHOTO_REQUEST_RE.test(normalizeForMatch(message ?? ''))
}

/** A short yes: "si", "sí porfa", "claro", "dale", "ok", "me encantaría"… */
const SHORT_YES_RE =
  /^(si|sii+|claro|ok|okay|oki|dale|va|sale|bueno|porfa|por favor|me encantaria|yes|sure|please)\b/
/** A bot question offering photos: "¿Le gustaría que le comparta una foto…?" */
const PHOTO_OFFER_RE = /¿[^?]*\b(fotos?|fotograf[ií]as?|im[aá]gen(es)?)\b[^?]*\?/i

/**
 * True when the guest's message is a plain yes to a photo offer the bot
 * made in its previous reply. Real case, 2026-09-24: "¿Le gustaría que le
 * comparta una foto de la habitación?" → "si" was not a photo request by
 * the words alone, so the photo was dropped and the guest got the
 * "dificultad temporal" fallback instead.
 */
export function acceptsPhotoOffer(
  guestMessage: string | null | undefined,
  previousBotReply: string | null | undefined,
): boolean {
  const guest = normalizeForMatch(guestMessage ?? '')
  if (!guest || guest.split(' ').length > 6 || !SHORT_YES_RE.test(guest)) return false
  return PHOTO_OFFER_RE.test(previousBotReply ?? '')
}

/**
 * The item a photo request points at when the request itself doesn't
 * name one ("y como es?" right after "cuánto sale la premium"): the
 * guest's latest message first, then the bot's previous reply, then the
 * guest's earlier messages, newest first. Each step must be an
 * unambiguous single match (`productAskedAbout`); null otherwise.
 */
export function productForPhotoRequest(
  latestGuestMessage: string,
  previousBotReply: string | null | undefined,
  earlierGuestMessages: readonly string[],
  productNames: readonly string[],
  businessName?: string | null,
): string | null {
  // A room-photo request must never fall back to the package's flyer.
  // Resolve only room products, including a room named in the package description.
  const roomRequested = /\b(habitacion(?:es)?|cuarto(?:s)?|suite(?:s)?|room(?:s)?)\b/.test(normalizeForMatch(latestGuestMessage))
  const candidates = roomRequested
    ? productNames.filter((name) => /\b(suite(?:s)?|habitacion(?:es)?|cuarto(?:s)?|room(?:s)?|cabana(?:s)?)\b/.test(normalizeForMatch(name)) && !/\b(paquete|package)\b/.test(normalizeForMatch(name)))
    : productNames
  for (const candidate of [latestGuestMessage, previousBotReply ?? '', ...earlierGuestMessages]) {
    const hit = productAskedAbout(candidate, candidates, businessName)
    if (hit) return hit
  }
  return null
}

/** The text sent with an item's photos when the model's reply was ONLY
 *  the photo marker — the photo is the answer, so no fallback message. */
export function photoOnlyReplyText(productName: string): string {
  const first = normalizeForMatch(productName).split(' ')[0] ?? ''
  const article = ['suite', 'habitacion', 'cabana', 'villa'].includes(first)
    ? 'la '
    : ['paquete', 'masaje', 'tour', 'salon', 'plan'].includes(first)
      ? 'el '
      : ''
  return `¡Con mucho gusto! Aquí puede ver ${article}${productName}. 😊`
}

/** "quiero hablar con una persona", "me comunica con un asesor", "páseme
 *  con recepción", "talk to a human"… (accents already stripped). */
const HUMAN_REQUEST_RE =
  /\b(?:hablar|comunicar(?:me|nos)?|comuniqueme|comunicame|conectar(?:me)?|conecteme|paseme|pasame|pasen(?:me)?|atender(?:me)?|atienda(?:me)?)\s+(?:con\s+)?(?:una?\s+|el\s+|la\s+|alguien\s+de\s+)?(?:persona|humano|humana|asesor|asesora|agente|encargad[oa]|alguien|recepcion|recepcionista|gerente|operador|operadora|ejecutiv[oa])\b|\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:human|person|agent|someone|representative)\b/
const NEGATED_HUMAN_REQUEST_RE = /\b(?:no|nunca|tampoco)\s+(?:quiero|necesito|deseo|hace\s+falta)?\s*(?:hablar|comunicar|pasar|conectar)/

/**
 * True when the guest plainly asks for a person. The hotel owner's rule
 * (VSR prompt): "YA PIDIÓ HABLAR CON UNA PERSONA — no vuelvas a
 * preguntar, inicia la transferencia". Live test 2026-09-25: "quiero
 * hablar con una persona por favor" got "¿Le gustaría que le conecte con
 * alguien del equipo?" from gpt-5.4-mini instead of the transfer.
 */
export function isExplicitHumanRequest(message: string | null | undefined): boolean {
  const text = normalizeForMatch(message ?? '')
  if (!text || NEGATED_HUMAN_REQUEST_RE.test(text)) return false
  return HUMAN_REQUEST_RE.test(text)
}

/** Discounts, pets, children, payment, schedules/policies — questions a
 *  gallery doesn't answer (accents already stripped). */
const POLICY_QUESTION_RE =
  /\b(descuentos?|rebaja|promo(?:cion(?:es)?)?|oferta|mascotas?|perr(?:o|os|ito|itos)|gat(?:o|os|ito)|pet\s+friendly|ninos?|bebes?|menores|pag(?:o|ar)|anticipo|deposit(?:o|ar)|transferencia|tarjeta|factura|reembolso|cancel(?:ar|acion)|politicas?|horarios?|check\s*(?:in|out)|desayuno|parqueo|wi\s*fi|discount|pets?|dogs?|kids|children|refund|breakfast|parking)\b/

/**
 * True when the guest asks a policy/practical question. A reply to it may
 * name a room or package in passing ("lo que sí existe es el 25% del
 * Paquete Luna de Miel") — that alone must not send the category banner
 * (live test 2026-09-25: the Paquetes banner went out on "¿me hacen
 * descuento?").
 */
export function isPolicyQuestion(message: string | null | undefined): boolean {
  return POLICY_QUESTION_RE.test(normalizeForMatch(message ?? ''))
}

/** Talking about something the guest already has — a booking, a payment,
 *  a quote or arrangement already in progress with the team — not browsing.
 *  VSR 2026-10-07: "Este sería el primer pago", "coordinar la actividad de
 *  la próxima semana", "había estado conversando con alguien… cotización",
 *  "Confirmado mi habitación de hoy?" all got a promotional banner. */
const EXISTING_BOOKING_RE =
  /\b(?:mis? reserva\w*|nuestras? reserva\w*|mi habitacion|nuestra habitacion|ya (?:reserve|reservamos|pague|pagamos)|habiamos (?:hecho|echo) una|hicimos (?:una|la) reserva\w*|(?:primer|segundo|ultimo) pago|comprobante|boleta|deposite|transferi|coordinar la|(?:habia|habiamos) estado (?:conversando|hablando)|la cotizacion|reservad[oa] a nombre|confirmad[oa] mi)\b/

export function isExistingBookingTalk(message: string | null | undefined): boolean {
  return EXISTING_BOOKING_RE.test(normalizeForMatch(message ?? ''))
}

/** The guest is asking for a NEW quote (another option, a price, other
 *  dates) — the only time a thread already in progress gets a banner
 *  again (owner, 2026-10-08). Accents already stripped. */
const NEW_QUOTE_RE =
  /\b(?:opcion(?:es)?|otr[ao]s? (?:habitacion\w*|fecha\w*|reserva\w*|paquete\w*|cotizacion\w*)|nuev[ao] (?:reserva\w*|cotizacion)|cotiz\w*|precios?|tarifas?|cuanto (?:cuesta|sale|seria|cobran|es|vale)|que (?:tienen|ofrecen|incluye)|que hay (?:de|para)|quiero reservar|quisiera reservar|me interesa\w*)\b/

export function isNewQuoteAsk(message: string | null | undefined): boolean {
  return NEW_QUOTE_RE.test(normalizeForMatch(message ?? ''))
}

const ARRIVAL_TIME_RE =
  /\b(a que hora|llego|llegar|llegamos|llegaria|llegariamos|llegada|entrar|ingresar|check\s*(?:in|out)|early check|late check|arrive|arrival)\b/

/**
 * True when the guest asks about arrival / check-in timing. "¿Puedo
 * entrar a la habitación a las 10?" names the category but isn't browsing
 * it — QA 2026-10-01 sent the Habitaciones banner to it.
 */
export function isArrivalTimeQuestion(message: string | null | undefined): boolean {
  return ARRIVAL_TIME_RE.test(normalizeForMatch(message ?? ''))
}

/** A sentence that mentions a photo… */
const PHOTO_WORD_RE = /\b(?:fotos?|fotograf[ií]as?|im[aá]gen(?:es)?)\b/i
/** …with a verb of sending or showing it… */
const PHOTO_VERB_RE = /\b(?:compart\w*|env[ií]\w*|mand\w*|mostr\w*|muestr\w*)\b/i
/** …phrased as an offer ("si gusta…", "puedo…", "¿le gustaría…?"). */
const PHOTO_OFFER_WORDING_RE =
  /¿|\bsi\s+(?:gusta|desea|lo\s+desea|quiere|prefiere|le\s+parece)\b|\bpuedo\b|\ble\s+gustar[ií]a\b/i

/**
 * The reply without the sentences that OFFER a photo ("¿Le gustaría que
 * le comparta una foto…?", "Si gusta, puedo compartirle una foto; …") —
 * for a turn whose item photo already went out (live tests 2026-09-25:
 * the photos arrived, then the text offered them). Returns the text
 * unchanged when nothing matches, or null when nothing would be left.
 */
export function stripTrailingPhotoOffer(text: string): string | null {
  const trimmed = text.trim()
  let changed = false
  const kept = trimmed
    .split('\n')
    .map((line) => {
      const sentences = line.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [line]
      return sentences
        .filter((sentence) => {
          const isOffer =
            PHOTO_WORD_RE.test(sentence) && PHOTO_VERB_RE.test(sentence) && PHOTO_OFFER_WORDING_RE.test(sentence)
          if (isOffer) changed = true
          return !isOffer
        })
        .join('')
        .trim()
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!changed) return trimmed
  return kept || null
}

/**
 * The guest has a voucher, gift certificate or a negotiated rate
 * (corporate, tour operator, "la de siempre") — the published-rate
 * total and deposit don't apply (VSR 2026-10-07: a guest with a prepaid
 * certificate was told "GTQ 970, anticipo GTQ 485"; staff had to say
 * "usted no paga nada"). The team confirms their rate instead.
 */
const SPECIAL_RATE_RE =
  /\b(?:voucher\w*|vaucher\w*|cupon\w*|certificado\w*|gift ?card|tarjeta de regalo|tour ?operador\w*|convenio|tarifa (?:corporativa|empresarial|especial|de siempre|que siempre)|la tarifa que siempre)\b/

export function isSpecialRateTalk(messages: readonly string[]): boolean {
  return messages.some((m) => SPECIAL_RATE_RE.test(normalizeForMatch(m)))
}

/**
 * The guest asks about or wants to use a voucher, "vale", gift card or
 * gift certificate — a teammate handles it (owner meeting, 2026-10-09).
 * "vale" only with an article or a qualifier: "¿cuánto vale?" and
 * "vale, gracias" are not vouchers.
 */
const GIFT_VOUCHER_RE =
  /\b(?:(?:un|el|mi|este|ese|los|unos|mis|del) vales?|vales? (?:de regalo|especial\w*|por|de descuento)|voucher\w*|vaucher\w*|cupon\w*|gift ?card|tarjetas? (?:de )?regalo|certificados? de regalo)\b/

export function isGiftVoucherAsk(message: string | null | undefined): boolean {
  return GIFT_VOUCHER_RE.test(normalizeForMatch(message ?? ''))
}

/**
 * Buying intent in the guest's own words ("¿tienen habitaciones?",
 * "quisiera información del spa", "necesitamos 10 habitaciones") — with
 * a category named, the banner is safe to send (owner, 2026-10-09).
 * Coordination ("los masajes serían el sábado?") is not intent.
 */
const QUOTE_INTENT_RE =
  /\b(?:disponib\w*|tienen|tendran?|hay (?:disponib\w*|espacio|cupo|habitac\w*)|informacion|info|costos?|reservar|hospedar\w*|hospedaje|alojamiento|quisiera|quiero|me gustaria|busco|buscando|necesito|necesitamos|cuestan|valen|salen|cobran|precio\w*|tarifa\w*)\b/

export function isQuoteIntent(message: string | null | undefined): boolean {
  return isNewQuoteAsk(message) || QUOTE_INTENT_RE.test(normalizeForMatch(message ?? ''))
}

/** Does this bot reply spell out a date ("…el 11/10/2026")? */
export function statesDate(text: string | null | undefined): boolean {
  return /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(text ?? '')
}
