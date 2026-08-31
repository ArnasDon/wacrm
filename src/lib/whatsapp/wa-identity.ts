/**
 * Sender identity on an inbound WhatsApp webhook (issue #519).
 *
 * Until 2026 a customer was always a phone number: `messages[].from`
 * and `contacts[].wa_id`. With WhatsApp usernames, Meta assigns every
 * user a **business-scoped user ID** (BSUID) — an id that is unique to
 * one business portfolio — and once a user adopts a username and the
 * business has no recent interaction history with them, Meta **omits
 * the phone number entirely**:
 *
 *   contacts: [{ profile: { name, username }, user_id, parent_user_id }]
 *   messages: [{ from_user_id, from_parent_user_id, id, ... }]
 *
 * `wa_id` and `from` are simply absent. Keying a contact on the phone
 * alone therefore resolved to the empty string for those senders, and
 * because the account-wide unique index is partial
 * (`WHERE phone_normalized <> ''`) nothing stopped a fresh contact —
 * and a fresh conversation — being created for *every single inbound
 * message* from that person.
 *
 * A BSUID is stable per (user, business portfolio), so it is the
 * better key when present. Phone stays the fallback, and the webhook
 * backfills the BSUID onto an already-known phone contact the first
 * time Meta sends one — which is what keeps a customer's history in
 * one place across the transition.
 *
 * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */

import {
  isValidE164,
  normalizePhone,
  sanitizePhoneForMeta,
} from './phone-utils'

/** The `contacts[]` entry Meta pairs with an inbound message. */
export interface WaContactPayload {
  profile?: { name?: string; username?: string }
  /** Phone number. Absent for a username-only sender. */
  wa_id?: string
  /** BSUID, e.g. "US.13491208655302741918". */
  user_id?: string
  /** Portfolio-level BSUID, e.g. "US.ENT.11815799212886844830". */
  parent_user_id?: string
}

/** The identity fields on a `messages[]` entry. */
export interface WaMessageIdentityPayload {
  /** Phone number. Absent for a username-only sender. */
  from?: string
  from_user_id?: string
  from_parent_user_id?: string
}

export interface WaIdentity {
  /** Digits-only phone, or `''` when Meta withheld it. */
  phone: string
  /** Business-scoped user id, or null. */
  waUserId: string | null
  /** Portfolio-level BSUID, or null. */
  waParentUserId: string | null
  /** WhatsApp username (no `@`), or null. */
  waUsername: string | null
  /** Profile display name, or `''`. */
  name: string
}

/**
 * BSUIDs are `COUNTRY.digits` or `COUNTRY.ENT.digits`. The only
 * property we rely on elsewhere is that they contain a `.` and a phone
 * number never does — see `isBusinessScopedUserId`.
 */
const BSUID_PATTERN = /^[A-Za-z]{2}\.(?:ENT\.)?[A-Za-z0-9]{4,}$/

/**
 * True for a BSUID / parent BSUID, false for anything phone-shaped.
 *
 * The send path uses this to choose Meta's `recipient` field over `to`,
 * so it must never mistake a phone number for a BSUID. It can't: a
 * sanitized phone number is digits only, and every BSUID carries a
 * two-letter prefix and a dot.
 */
export function isBusinessScopedUserId(value: string | null | undefined): boolean {
  return !!value && BSUID_PATTERN.test(value.trim())
}

/** Drop a leading `@` if Meta ever starts sending one. */
function cleanUsername(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^@/, '')
  return trimmed ? trimmed : null
}

function cleanBsuid(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  // Refuse anything that doesn't look like a BSUID rather than storing
  // it — a bad value in `wa_user_id` becomes a permanent wrong contact
  // key, and the phone fallback is still available.
  return isBusinessScopedUserId(trimmed) ? trimmed : null
}

/**
 * Collapse a message + its paired `contacts[]` entry into one identity.
 *
 * Both objects carry the same person under different field names; the
 * message-level fields (`from`, `from_user_id`) win when the two
 * disagree, since those describe the delivery we're processing.
 */
export function resolveInboundIdentity(
  message: WaMessageIdentityPayload,
  contact?: WaContactPayload
): WaIdentity {
  return {
    phone: normalizePhone(message.from ?? contact?.wa_id ?? ''),
    waUserId: cleanBsuid(message.from_user_id) ?? cleanBsuid(contact?.user_id),
    waParentUserId:
      cleanBsuid(message.from_parent_user_id) ??
      cleanBsuid(contact?.parent_user_id),
    waUsername: cleanUsername(contact?.profile?.username),
    name: contact?.profile?.name?.trim() ?? '',
  }
}

/**
 * False when Meta gave us neither a phone nor a BSUID — there is no key
 * to find or create a contact under, so the delivery has to be dropped
 * rather than turned into an anonymous row.
 */
export function hasUsableIdentity(identity: WaIdentity): boolean {
  return !!identity.phone || !!identity.waUserId
}

/**
 * Best available label for a contact row's `name`, which is what the
 * inbox and contact list render. Prefers the profile name, then the
 * username, then the phone, and only falls back to the BSUID — an
 * opaque string, but better than a blank row.
 */
export function identityDisplayName(identity: WaIdentity): string {
  if (identity.name) return identity.name
  if (identity.waUsername) return identity.waUsername
  if (identity.phone) return identity.phone
  return identity.waUserId ?? ''
}

/**
 * What to render where a contact's phone number goes.
 *
 * A contact Meta only ever identified by BSUID has `phone = ''`, which
 * left the inbox's phone row and the contact detail's phone field
 * rendering as a blank line. Falls back to `@username`, then to the
 * BSUID itself, so the row always says something true about how to
 * recognise this person.
 */
export function contactHandle(contact: {
  phone?: string | null
  wa_username?: string | null
  wa_user_id?: string | null
}): string {
  if (contact.phone?.trim()) return contact.phone
  if (contact.wa_username?.trim()) return `@${contact.wa_username.trim()}`
  return contact.wa_user_id?.trim() ?? ''
}

export interface WaSendTarget {
  /** The value to hand a `meta-api` sender as `to`. */
  target: string
  /**
   * True when `target` is a phone number. Callers use it to decide
   * whether the trunk-prefix variant retry (`phoneVariants`) applies —
   * a BSUID is opaque and has exactly one correct form.
   */
  isPhone: boolean
}

/**
 * How to address a Meta send at a contact, or null when we can't.
 *
 * Every per-contact send path (the inbox composer, the Flows engine,
 * automations, reactions) used to demand a valid phone number and throw
 * otherwise, which made a customer who had adopted a WhatsApp username
 * unanswerable: their messages arrived, and every reply failed
 * (issue #519). Phone stays preferred — it's the only branch the
 * variant retry can help — with the BSUID as the fallback.
 */
export function resolveContactSendTarget(contact: {
  phone?: string | null
  wa_user_id?: string | null
} | null | undefined): WaSendTarget | null {
  const sanitized = sanitizePhoneForMeta(contact?.phone ?? '')
  if (isValidE164(sanitized)) return { target: sanitized, isPhone: true }

  const waUserId = contact?.wa_user_id?.trim()
  if (isBusinessScopedUserId(waUserId)) {
    return { target: waUserId as string, isPhone: false }
  }

  return null
}
