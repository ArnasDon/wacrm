import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  MARK_DEAL_WON_SENTINEL,
  MOVE_DEAL_SENTINEL_PREFIX,
  MOVE_DEAL_SENTINEL_SUFFIX,
  SEND_CATALOG_SENTINEL,
  SEND_PRODUCT_PHOTO_SENTINEL_PREFIX,
  SEND_PRODUCT_PHOTO_SENTINEL_SUFFIX,
  SEND_RESTAURANT_MENU_SENTINEL,
  SET_TEMPERATURE_SENTINEL_PREFIX,
  SET_TEMPERATURE_SENTINEL_SUFFIX,
  SET_CONTACT_NAME_SENTINEL_PREFIX,
  SET_CONTACT_NAME_SENTINEL_SUFFIX,
  SCHEDULE_APPOINTMENT_SENTINEL_PREFIX,
  SCHEDULE_APPOINTMENT_SENTINEL_SUFFIX,
  CREATE_QUOTE_SENTINEL_PREFIX,
  CREATE_QUOTE_SENTINEL_SUFFIX,
  QUICK_REPLY_SENTINEL_PREFIX,
  QUICK_REPLY_SENTINEL_SUFFIX,
  RECORD_RESERVATION_SENTINEL_PREFIX,
  RECORD_RESERVATION_SENTINEL_SUFFIX,
  RESERVATION_MARKER_CATEGORIES,
  APPOINTMENT_ACTION_SENTINEL_PREFIX,
  APPOINTMENT_ACTION_SENTINEL_SUFFIX,
  aiRequestTimeoutMs,
} from './defaults'
import type { LeadTemperature } from '@/types'

const VALID_TEMPERATURES = new Set<LeadTemperature>(['cold', 'warm', 'hot'])
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Provider failures that are expected to self-heal — the same call a
 * moment later has a real chance of succeeding. Everything else
 * (`invalid_key`, `unsupported_provider`) won't change on a retry and
 * must surface immediately. Drove the 2026-08-30 incident: right after
 * an account's Anthropic key was restored, the next inbound hit a
 * transient overload during generation and the customer's question was
 * silently dropped with no retry and no handoff.
 */
const RETRYABLE_AI_ERROR_CODES = new Set([
  'timeout',
  'rate_limited',
  'network_error',
  'provider_error',
  'empty_response',
])

/** True when `err` is an `AiError` whose failure mode is worth one retry
 *  (see `RETRYABLE_AI_ERROR_CODES`). */
export function isRetryableAiError(err: unknown): boolean {
  return err instanceof AiError && RETRYABLE_AI_ERROR_CODES.has(err.code)
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into
 * `{ text, handoff, markDealWon, moveToStageName, usage }`. Any sentinel
 * can appear alone or trailing a partial reply; either way we strip the
 * marker(s) from the text sent to the customer. `usage` is passed
 * straight through (null when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const markDealWon = raw.includes(MARK_DEAL_WON_SENTINEL)
  const sendCatalog = raw.includes(SEND_CATALOG_SENTINEL)
  const sendRestaurantMenu = raw.includes(SEND_RESTAURANT_MENU_SENTINEL)

  const sendPhotoMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SEND_PRODUCT_PHOTO_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SEND_PRODUCT_PHOTO_SENTINEL_SUFFIX)}`,
    ),
  )
  const sendPhotoProductName = sendPhotoMatch ? sendPhotoMatch[1].trim() || null : null

  const moveMatch = raw.match(
    new RegExp(
      `${escapeRegExp(MOVE_DEAL_SENTINEL_PREFIX)}(.+?)${escapeRegExp(MOVE_DEAL_SENTINEL_SUFFIX)}`,
    ),
  )
  const moveToStageName = moveMatch ? moveMatch[1].trim() : null

  const temperatureMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SET_TEMPERATURE_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SET_TEMPERATURE_SENTINEL_SUFFIX)}`,
    ),
  )
  const temperatureRaw = temperatureMatch ? temperatureMatch[1].trim().toLowerCase() : null
  const leadTemperature = VALID_TEMPERATURES.has(temperatureRaw as LeadTemperature)
    ? (temperatureRaw as LeadTemperature)
    : null

  const contactNameMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SET_CONTACT_NAME_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SET_CONTACT_NAME_SENTINEL_SUFFIX)}`,
    ),
  )
  // Only a light trim here — `auto-reply.ts` does the real validation
  // (length, must contain a letter, not the phone number) before writing.
  const contactName = contactNameMatch ? contactNameMatch[1].trim().replace(/\s+/g, ' ') || null : null

  const appointmentMatch = raw.match(
    new RegExp(
      `${escapeRegExp(SCHEDULE_APPOINTMENT_SENTINEL_PREFIX)}(.+?)${escapeRegExp(SCHEDULE_APPOINTMENT_SENTINEL_SUFFIX)}`,
    ),
  )
  let appointmentProposal: { start: string; end: string; email: string } | null = null
  if (appointmentMatch) {
    const [start, end, email] = appointmentMatch[1].split('|').map((s) => s.trim())
    if (start && end && email) appointmentProposal = { start, end, email }
  }

  const quoteMatch = raw.match(
    new RegExp(
      `${escapeRegExp(CREATE_QUOTE_SENTINEL_PREFIX)}(.+?)${escapeRegExp(CREATE_QUOTE_SENTINEL_SUFFIX)}`,
    ),
  )
  let quoteProposal: GenerateResult['quoteProposal'] = null
  if (quoteMatch) {
    const parts = quoteMatch[1].split('|').map((s) => s.trim())
    const [rawFormat, itemsStr] = parts
    const format = rawFormat === 'text' ? 'text' : 'pdf'
    const items = (itemsStr ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, qtyRaw] = entry.split(':').map((s) => s.trim())
        if (!name) return null
        const qty = Number(qtyRaw)
        return { name, qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1 }
      })
      .filter((item): item is { name: string; qty: number } => item !== null)
    // NIT/email are optional (migration 082 — ask_customer_tax_info):
    // when an account hasn't opted in, the model is told to write the
    // literal "N/A" in both slots (never to leave them genuinely empty
    // — an earlier version asked for that and the model would drop the
    // whole marker rather than risk the exact-empty-segment syntax,
    // silently killing every quote for that account, 2026-08-25
    // incident). Address always comes from the LAST segment rather
    // than a fixed position 5, so a marker that's missing the NIT/email
    // slots entirely (the model reverting to the old, wrong shape)
    // still resolves the address correctly instead of also failing.
    const address = parts[parts.length - 1]
    const isPlaceholder = (v: string | undefined) => !v || /^n\/?a$/i.test(v)
    const nit = parts.length >= 5 && !isPlaceholder(parts[2]) ? parts[2] : ''
    const email = parts.length >= 5 && !isPlaceholder(parts[3]) ? parts[3] : ''
    // Items and address are still required — a marker missing either
    // means the model jumped ahead without actually having what it
    // needs; better to silently ignore it than send a broken quote.
    if (items.length > 0 && address) {
      quoteProposal = { format, items, customerNit: nit, customerEmail: email, customerAddress: address }
    }
  }

  const quickReplyMatch = raw.match(
    new RegExp(
      `${escapeRegExp(QUICK_REPLY_SENTINEL_PREFIX)}(.+?)${escapeRegExp(QUICK_REPLY_SENTINEL_SUFFIX)}`,
    ),
  )
  const quickReplyId = quickReplyMatch ? quickReplyMatch[1].trim() : null

  const reservationMatch = raw.match(
    new RegExp(
      `${escapeRegExp(RECORD_RESERVATION_SENTINEL_PREFIX)}(.+?)${escapeRegExp(RECORD_RESERVATION_SENTINEL_SUFFIX)}`,
    ),
  )
  let reservationProposal: GenerateResult['reservationProposal'] = null
  if (reservationMatch) {
    const [catRaw, ...restParts] = reservationMatch[1].split('|')
    const category = (catRaw ?? '').trim().toLowerCase()
    if ((RESERVATION_MARKER_CATEGORIES as readonly string[]).includes(category)) {
      const fields: Record<string, string> = {}
      for (const pair of restParts.join('|').split(';')) {
        const eq = pair.indexOf('=')
        if (eq < 1) continue
        const key = pair.slice(0, eq).trim().toLowerCase()
        const val = pair.slice(eq + 1).trim()
        if (key && val) fields[key] = val
      }
      // A category with nothing else is still worth recording (a bare
      // "guest is asking about a room") — but only if the model gave us
      // at least the category cleanly.
      reservationProposal = {
        category: category as NonNullable<GenerateResult['reservationProposal']>['category'],
        fields,
      }
    }
  }

  const apptActionMatch = raw.match(
    new RegExp(
      `${escapeRegExp(APPOINTMENT_ACTION_SENTINEL_PREFIX)}(confirm|cancel)${escapeRegExp(APPOINTMENT_ACTION_SENTINEL_SUFFIX)}`,
      'i',
    ),
  )
  const appointmentAction: GenerateResult['appointmentAction'] = apptActionMatch
    ? (apptActionMatch[1].toLowerCase() as 'confirm' | 'cancel')
    : null

  let text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .split(MARK_DEAL_WON_SENTINEL)
    .join('')
    .split(SEND_CATALOG_SENTINEL)
    .join('')
    .split(SEND_RESTAURANT_MENU_SENTINEL)
    .join('')
    .replace(sendPhotoMatch ? sendPhotoMatch[0] : '', '')
    .replace(moveMatch ? moveMatch[0] : '', '')
    .replace(temperatureMatch ? temperatureMatch[0] : '', '')
    .replace(contactNameMatch ? contactNameMatch[0] : '', '')
    .replace(appointmentMatch ? appointmentMatch[0] : '', '')
    .replace(quoteMatch ? quoteMatch[0] : '', '')
    .replace(quickReplyMatch ? quickReplyMatch[0] : '', '')
    .replace(reservationMatch ? reservationMatch[0] : '', '')
    .replace(apptActionMatch ? apptActionMatch[0] : '', '')
    .trim()

  // --- second-pass cleanup, in order of increasing severity ---
  //
  // The named extraction above only pulls the FIRST occurrence of each
  // payload marker and only its exact shape. The model can still leave
  // behind: a duplicate marker, one whose payload the named parser
  // couldn't read (a stray "]" mid-value, a rogue line break), or one
  // it wrote on its own line. On the hotel vertical — which stacks the
  // most trailing markers of any config — that used to be common and
  // *every* leftover forced a sticky handoff. Split by how much a
  // missed marker actually matters:
  //
  //  (a) a leftover from a LOW-STAKES family — one that self-heals
  //      (re-emitted next turn: `record_reservation`, `set_temperature`)
  //      or just sends something that already exists (`send_catalog`,
  //      `send_restaurant_menu`) or is control-flow the model can
  //      re-trigger (`HANDOFF`, `mark_deal_won`, `move_deal`,
  //      `QUICK_REPLY`). Strip it SILENTLY — never a reason to park the
  //      conversation on a human.
  const SAFE_KNOWN_MARKER_RE =
    /\[\[\s*(?:HANDOFF|QUICK_REPLY(?::[^\]]{0,200})?|ACTION:(?:mark_deal_won|move_deal|send_catalog|send_photo|send_restaurant_menu|set_temperature|set_contact_name|record_reservation|appointment)(?::[^\]]{0,600})?)\s*\]\]/gi
  const straySafe = text.match(SAFE_KNOWN_MARKER_RE)
  if (straySafe) {
    console.warn('[ai generate] stripped stray/duplicate low-stakes marker(s) from reply text:', straySafe)
    text = text.replace(SAFE_KNOWN_MARKER_RE, '').trim()
  }

  //  (b) an OPEN "[[" with no close before end-of-string → the classic
  //      signature of the completion hitting the output-token ceiling
  //      mid-marker. The prose before it is complete; drop the dangling
  //      fragment SILENTLY.
  const truncatedFragment = /\[\[[^[\]]{0,600}$/
  if (truncatedFragment.test(text)) {
    console.warn('[ai generate] dropped a truncated trailing marker fragment from reply text')
    text = text.replace(truncatedFragment, '').trim()
  }

  //  (c) anything `[[...]]`-shaped that is STILL here: a malformed
  //      `create_quote_chat` / `schedule_appointment` (the model
  //      promised the customer a quote or a booking and the marker
  //      didn't parse, so that action never ran and nothing else will
  //      catch it), or a genuinely unknown token (the 2026-08-25
  //      incident's signature). Strip it AND flag it so auto-reply hands
  //      the conversation to a human.
  const unknownSentinel = /\[\[[\s\S]{1,300}?\]\]/
  const sentinelLeakDetected = unknownSentinel.test(text)
  if (sentinelLeakDetected) {
    console.error('[ai generate] a high-stakes/unrecognised sentinel-shaped token survived stripping, force-removing it:', text)
    text = text.replace(new RegExp(unknownSentinel.source, 'g'), '').trim()
  }

  return {
    text,
    handoff,
    markDealWon,
    moveToStageName,
    sendCatalog,
    sendPhotoProductName,
    sendRestaurantMenu,
    leadTemperature,
    contactName,
    appointmentProposal,
    sentinelLeakDetected,
    quoteProposal,
    quickReplyId,
    reservationProposal,
    appointmentAction,
    usage,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
