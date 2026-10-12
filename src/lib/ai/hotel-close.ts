// ============================================================
// Pure helpers for the hotel bot's single warm CLOSE (see the CLOSING
// protocol in defaults.ts). Live test run 2026-09-24 (Villa San
// Ricardo, 18 chats) showed the model, with every field already known:
//  - ending its reply with a permission question ("¿Desea que le deje
//    registrada la solicitud…?") in about half the closes, and
//  - writing "Queda anotado…" but forgetting the confirm marker, so the
//    team was never told.
// These let the code enforce the close deterministically instead of
// hoping the model follows the prompt.
// ============================================================

/** A trailing question that only asks permission to register / confirm /
 *  book what is already complete — never one that asks for information. */
const PERMISSION_QUESTION_RE =
  /¿\s*(?:le\s+gustar[ií]a|desea|quiere|gusta|le\s+parece|me\s+permite|puedo|lo|la)\b[^?¿]*\b(?:dej(?:e|o|emos|arla|arlo|ársela|ársel[oa])|registr\w*|anot\w*|reserv\w*|confirm\w*|apart\w*|agend\w*|proceder|avanz\w*|lista|listo|conect\w*|comuni\w*)\b[^?¿]*\?\s*$/i

/** The same permission offer written as a statement: "Si desea, le dejo
 *  la solicitud lista para que el equipo…" (re-tests 2026-09-24, pruebas
 *  #29/#45/#46 — no "?", so the question form above never caught it). */
const PERMISSION_OFFER_RE =
  /(?:^|[.!\n]\s*)(si\s+(?:lo\s+)?(?:desea|gusta|le\s+parece|quiere|prefiere)\b[^.!?\n]*\b(?:dej\w*|registr\w*|anot\w*|reserv\w*|confirm\w*|apart\w*)\b[^.!?\n]*[.!]?)\s*$/i

/** "Quedo atenta para registrar las fechas." with every field already
 *  known — the bot waiting on a go-ahead nobody needs to give, so the
 *  request never closed and the team was never told (test run
 *  2026-09-24, prueba #40 / B51). */
const WAITING_TO_REGISTER_RE =
  /(?:^|[.!\n]\s*)((?:quedo|me\s+quedo|estoy|quedamos)\s+(?:muy\s+)?atent[ao]s?\b[^.!?\n]*\b(?:dej\w*|registr\w*|anot\w*|reserv\w*|confirm\w*|apart\w*|agend\w*)\b[^.!?\n]*[.!]?)\s*$/i

function stripOnce(trimmed: string): string | null {
  const match = trimmed.match(PERMISSION_QUESTION_RE)
  if (match && match.index !== undefined) return trimmed.slice(0, match.index).trimEnd()
  for (const re of [PERMISSION_OFFER_RE, WAITING_TO_REGISTER_RE]) {
    const offer = trimmed.match(re)
    if (offer && offer.index !== undefined) return trimmed.slice(0, trimmed.length - offer[1].length).trimEnd()
  }
  return null
}

/**
 * When `text` ends in a permission-only question or offer (or a "quedo
 * atenta para registrarla" wait), returns the text without it (trimmed)
 * — repeatedly, since the model sometimes stacks two ("Quedo atenta para
 * registrarla. ¿Desea que se la deje lista?"). Returns null when the
 * ending is anything else — a real question for missing data, or no
 * offer at all.
 */
export function stripTrailingPermissionQuestion(text: string): string | null {
  let current = text.trimEnd()
  let stripped: string | null = null
  for (let i = 0; i < 3; i += 1) {
    const next = stripOnce(current)
    if (next === null) break
    stripped = current = next
  }
  return stripped
}

/** The last two sentences ask the guest for something ("por favor
 *  compárteme el NIT", "indíqueme la fecha", "solo me hace falta saber
 *  cuántos adultos serían") without a "?" — still asking, so never an
 *  implicit close (re-test 2026-09-24, prueba #36; live chat 2026-09-29). */
const IMPERATIVE_ASK_RE =
  /\b(?:comp[aá]rt[ae]me|comp[aá]rtame|ind[ií]qu[ea]me|ind[ií]queme|d[ií]game|dime|env[ií][ea]me|conf[ií]rme(?:me)?|conf[ií]rmeme|p[aá]seme|me\s+(?:comparte|indica|confirma|dice|env[ií]a|ayuda\s+con)|por\s+favor\s+(?:me\s+)?(?:comp|ind|env|conf|dig)|(?:me\s+)?(?:hace|har[ií]a)\s+falta\s+(?:saber|conocer|confirmar)|(?:solo\s+)?me\s+falta(?:r[ií]a)?\s+(?:saber|conocer|confirmar|el|la|los|las|su|cu[aá]nt|qu[eé])|necesito\s+(?:saber|conocer|confirmar)|me\s+gustar[ií]a\s+saber)/i

/** True when the reply still asks the guest something — a "?" at the end
 *  or an imperative request in its last two sentences. */
export function isStillAsking(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.endsWith('?')) return true
  const sentences = trimmed.split(/(?<=[.!?\n])\s+/).filter(Boolean)
  return IMPERATIVE_ASK_RE.test(sentences.slice(-2).join(' '))
}

/** The bot's reply asked who the guest is / who the booking is for. */
const ASKED_NAME_RE =
  /con\s+qui[eé]n\s+tengo\s+el\s+gusto|a\s+nombre\s+de\s+qui[eé]n|(?:su|tu)\s+nombre(?:\s+completo)?\b|c[oó]mo\s+se\s+llama|nombre\s+(?:completo\s+)?(?:para|de)\s+la\s+(?:reserva|solicitud)/i

const NAME_LEAD_IN_RE = /^(?:(?:hola|buenas|buenos\s+d[ií]as|buenas\s+(?:tardes|noches))[,!.\s]+)?(?:con|soy|habla|me\s+llamo|mi\s+nombre\s+es|a\s+nombre\s+de|ser[ií]a\s+a\s+nombre\s+de|ser[ií]a|es)\s+/i
const NAME_TRAILER_RE = /[\s,.!]+(?:por\s+favor|porfa|gracias|muchas\s+gracias)[\s.!]*$/i
/** Words that make the answer something other than a bare name. */
const NOT_A_NAME_RE =
  /(?<!\p{L})(?:no|s[ií]|ok|okay|gracias|habitaci[oó]n|suite|reserv\p{L}*|fecha|personas?|adultos?|ni[ñn]os?|precio|cu[aá]nto|quiero|necesito|para|del?|al|octubre|noviembre|diciembre|enero|hola|buenas)(?!\p{L})|\d|[?@]/iu

/**
 * The guest's name, when the bot's previous reply asked for it and the
 * guest's answer is just a name ("Mercedes Marroquí por favor", "Con
 * Juan", "Soy Ana López"). A code-side fallback for the set_contact_name
 * marker, which the model sometimes skips (live chat 2026-09-29) — the
 * close now waits for the name, so a missed marker must not strand a
 * complete request. Returns null for anything that isn't clearly a name.
 */
export function nameFromAnswer(previousBotReply: string, answer: string): string | null {
  if (!ASKED_NAME_RE.test(previousBotReply)) return null
  let name = answer.trim().split('\n')[0].trim()
  name = name.replace(NAME_TRAILER_RE, '').replace(NAME_LEAD_IN_RE, '').replace(/[.!,\s]+$/, '').trim()
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 5) return null
  if (NOT_A_NAME_RE.test(name)) return null
  if (!words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w))) return null
  return words.map((w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1)).join(' ')
}

/** A trailing "si gusta, (también) le comparto el menú/catálogo…" when the
 *  system is sending that very attachment this turn — it reads as an offer
 *  the attachment then contradicts (pruebas #3/#44). */
const ATTACHMENT_OFFER_RE =
  /(?:^|[.!\n]\s*)(si\s+(?:lo\s+)?(?:desea|gusta|quiere|le\s+parece)[^.!?\n]*\b(?:compart\w*|env[ií]\w*|mand\w*)\b[^.!?\n]*\b(?:men[uú]|carta|cat[aá]logo)[^.!?\n]*[.!?]?)\s*$/i

export function stripTrailingAttachmentOffer(text: string): string | null {
  const trimmed = text.trimEnd()
  const m = trimmed.match(ATTACHMENT_OFFER_RE)
  if (!m || m.index === undefined) return null
  return trimmed.slice(0, trimmed.length - m[1].length).trimEnd()
}

const CLOSE_LINES = [
  'Queda registrada su solicitud; en breve nuestro equipo le escribe para confirmarle disponibilidad y el total. 😊',
  '¡Listo! Su solicitud ya está con nuestro equipo, que le escribirá en breve para confirmarle disponibilidad y el total.',
  'Ya quedó registrada; nuestro equipo le contactará muy pronto para confirmarle disponibilidad y el total. 🙌',
]

/** A warm, varied close line to replace a stripped permission question. */
export function closeLine(variant: number): string {
  return CLOSE_LINES[Math.abs(variant) % CLOSE_LINES.length]
}

/**
 * Quetzal/dollar amounts written in a reply ("Q1,160", "GTQ 1,500",
 * "Q.300", "$120"). Small numbers (< 100) are ignored — minutes, people
 * and times aren't prices.
 */
export function mentionedAmounts(text: string): number[] {
  const out: number[] = []
  const re = /(?:GTQ|Q\.?|\$|USD)\s?(\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,]\d{1,2})?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/[,.]/g, ''))
    if (Number.isFinite(n) && n >= 100) out.push(n)
  }
  return out
}

/** A sentence about an add-on's own price (extra bed, child rate, spa,
 *  activities…), not the stay's total. */
const ADD_ON_PRICE_RE =
  /\b(?:cama\s+(?:adicional|extra)|persona\s+adicional|ni[ñn]os?|ni[ñn]as?|menores|spa|masajes?|cuatrimotos?|bicicletas?|tours?|actividad(?:es)?|mascotas?|decoraci[oó]n|catering|men[uú])\b/i

/**
 * Some amount in `text` that is neither the real total nor its deposit.
 * Amounts in a sentence about an add-on's own price are skipped (live
 * test 2026-09-26: "la cama adicional… Q300 en temporada normal y Q400 en
 * temporada alta" drew a "corrección importante sobre el monto" for 5
 * adults whose total the bot never stated).
 */
export function hasConflictingAmount(text: string, total: number, deposit: number): boolean {
  return text
    .split(/[!?\n]+|\.(?=\s|$)/)
    .filter((sentence) => !ADD_ON_PRICE_RE.test(sentence))
    .some((sentence) => mentionedAmounts(sentence).some((n) => n !== Math.round(total) && n !== Math.round(deposit)))
}

/** A YYYY-MM-DD date strictly before today's YYYY-MM-DD (string compare). */
export function isPastDate(dateISO: string | null | undefined, todayISO: string | null | undefined): boolean {
  return Boolean(dateISO && todayISO && dateISO < todayISO)
}

/** "Queda anotada…", "le registro…", "ya quedó actualizada…" — the reply
 *  tells the guest their request was saved. */
const NOTED_CLAIM_RE =
  /\b(?:queda(?:n)?|qued[oó]|ya\s+(?:qued[oó]|est[aá]n?))\s+(?:anotad|registrad|apuntad|actualizad)[ao]s?\b|\ble\s+(?:registro|anoto|actualizo)\b|\b(?:dejo|dejamos)\s+(?:anotad|registrad)[ao]s?\b/i

/**
 * True when the reply claims the request was noted/updated. Paired with
 * "no record_reservation marker this turn", that's a claim nothing backs
 * (live test 2026-09-24: "Queda anotada la Suite Clásica Doble para 3
 * personas…" while the saved request stayed Suite Premium for 2).
 */
export function claimsRequestNoted(text: string): boolean {
  return NOTED_CLAIM_RE.test(text)
}

/** "Queda solicitado su Paquete…", "ya quedó reservada…", "I've booked…" —
 *  the reply tells the guest the request is DONE (sent to the team). */
const CLOSE_CLAIM_RE =
  /\b(?:queda(?:n)?|qued[oó]|ya\s+(?:qued[oó]|est[aá]n?))\s+(?:solicitad|reservad|confirmad)[ao]s?\b|\bI(?:['’]ve| have)\s+(?:noted|booked|requested|registered)\b/i

/**
 * The reply minus the sentences that claim the request is closed, or
 * `null` when it makes no such claim. For a request still missing a field
 * (QA 2026-10-01: "Ya queda solicitado su Paquete Romántico…" with no
 * name yet, followed by the system's "¿a nombre de quién…?"). May return
 * '' when the claim was the whole reply.
 */
export function replyWithoutCloseClaim(text: string): string | null {
  if (!CLOSE_CLAIM_RE.test(text)) return null
  return text
    .split(/\n+/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((s) => !CLOSE_CLAIM_RE.test(s)).join(' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The reply minus the sentences that claim the request was noted — used
 * when nothing was actually saved. QA 2026-10-01: "¿cómo llego? ¿tienen
 * transporte?" got its whole answer swapped for a "No pude guardar…"
 * error because one sentence said "lo dejo anotado". Keep the answer,
 * drop only the false claim, and say the team confirms.
 */
export function replyWithoutNotedClaim(text: string): string {
  const kept = text
    .split(/\n+/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((s) => !NOTED_CLAIM_RE.test(s)).join(' ').trim())
    .filter(Boolean)
    .join('\n\n')
  if (!kept) return 'Ya le pasé su solicitud al equipo del hotel; se la confirman por este chat en breve.'
  // Don't tack it on when the reply already says the team follows up
  // (VSR 2026-10-07: "…el equipo del hotel se lo confirma" twice in a row).
  return /\b(?:equipo|compa[nñ]er[oa]|asesor[a]?|recepci[oó]n)\b/i.test(kept)
    ? kept
    : `${kept}\n\nYa le pasé su solicitud al equipo del hotel; se la confirman por este chat en breve.`
}
