// ============================================================
// Classify a WhatsApp chat identifier as an individual contact,
// group, community, or channel — so inbound webhook processing can
// skip everything that isn't a real 1:1 customer conversation.
//
// Only relevant for uazapi/Z-API (unofficial, WhatsApp-Web-based
// providers) — Meta's official Cloud API never delivers group,
// community, or channel messages, so this classifier never runs on
// that path.
//
// WhatsApp JIDs are suffixed by chat kind:
//   <digits>@s.whatsapp.net   individual contact (modern)
//   <digits>@c.us              individual contact (legacy/Baileys)
//   <digits>@g.us               group — this INCLUDES a community's
//                                own announcement group. WhatsApp
//                                communities are, under the hood, a
//                                bundle of @g.us groups; there is no
//                                separate JID suffix for "community".
//   <digits>@newsletter          channel/broadcast channel
//   <digits>@broadcast            legacy broadcast list
//
// Communities: detected via an explicit provider flag when the
// payload carries one (`isCommunity` / `isParentGroup`, naming
// varies), NOT by JID suffix alone — the suffix can't tell a
// community's announcement group apart from an ordinary group.
// UNCONFIRMED against a real community-message payload from this
// account as of writing (see the webhook routes' own TODOs on this
// file) — treat as best-effort until verified against a live event.
//
// Fallback heuristic (`looksLikeGroupOrCommunityId`): once a
// provider strips the JID suffix (uazapi's `stripJidSuffix`, or a
// provider that never sends an `@`-suffixed value to begin with),
// the remaining digit string is still distinguishable from a real
// phone number — E.164 numbers cap at 15 digits; WhatsApp group and
// community ids run 18-20 digits. This is the last line of defense
// so a provider quirk we haven't seen yet doesn't quietly let a
// group back into the inbox.
// ============================================================

export type ChatKind = 'individual' | 'group' | 'community' | 'channel'

const GROUP_SUFFIXES = new Set(['g.us'])
const CHANNEL_SUFFIXES = new Set(['newsletter', 'broadcast'])
const INDIVIDUAL_SUFFIXES = new Set(['s.whatsapp.net', 'c.us'])

export interface ClassifyChatOptions {
  /** Explicit "is a community" flag, when the provider's payload carries one. */
  explicitIsCommunity?: boolean
  /**
   * Explicit "is a group" flag, when the provider's payload carries
   * one separately from the chat id (e.g. a hypothetical Z-API
   * `isGroup` field — kept optional since it isn't confirmed present
   * on every event type).
   */
  explicitIsGroup?: boolean
}

/**
 * A real E.164 phone number is at most 15 digits (ITU-T E.164).
 * WhatsApp group/community ids (the numeric part of a `@g.us` JID)
 * run noticeably longer — typically 18-20 digits, often starting
 * with a `12`-prefixed timestamp-like number. This is only a
 * *negative* signal ("too long to plausibly be a phone number") —
 * never used to positively confirm "individual", only to catch
 * groups/communities a provider quirk let slip past the JID-suffix
 * check.
 */
export function looksLikeGroupOrCommunityId(value: string): boolean {
  return value.replace(/\D/g, '').length > 15
}

/**
 * Classify a raw WhatsApp identifier. Accepts either a full JID
 * (`"1203634...@g.us"`) or an already-stripped digit string (in
 * which case only the length heuristic — and any explicit flag
 * passed in `opts` — applies).
 */
export function classifyWhatsAppChat(
  rawId: string,
  opts: ClassifyChatOptions = {},
): ChatKind {
  if (opts.explicitIsCommunity) return 'community'

  const atIndex = rawId.indexOf('@')
  if (atIndex >= 0) {
    const suffix = rawId.slice(atIndex + 1).toLowerCase()
    const digits = rawId.slice(0, atIndex)
    if (GROUP_SUFFIXES.has(suffix)) return 'group'
    if (CHANNEL_SUFFIXES.has(suffix)) return 'channel'
    if (INDIVIDUAL_SUFFIXES.has(suffix)) {
      // Trust the suffix, but still guard against a provider that
      // mislabels a group/community under an individual-looking one.
      return looksLikeGroupOrCommunityId(digits) ? 'group' : 'individual'
    }
    // Unknown suffix — fall through to the digit heuristic below
    // rather than assuming "individual" for a chat kind we've never
    // seen (e.g. a future WhatsApp chat type).
    return looksLikeGroupOrCommunityId(digits) ? 'group' : 'individual'
  }

  if (opts.explicitIsGroup) return 'group'
  return looksLikeGroupOrCommunityId(rawId) ? 'group' : 'individual'
}

/** True for anything that isn't a real 1:1 customer conversation. */
export function isNonIndividualChat(kind: ChatKind): boolean {
  return kind !== 'individual'
}
