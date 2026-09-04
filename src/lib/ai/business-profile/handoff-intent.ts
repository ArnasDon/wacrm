// ============================================================
// Handoff intent matching — AI optimization project, FASE 6.
//
// ARCHITECTURE (per the explicit "no dejar que el LLM controle el CRM"
// requirement): the model's ONLY signal is still the existing
// [[HANDOFF]] sentinel (src/lib/ai/defaults.ts) — completely unchanged.
// The model never names a department/contact id, never decides an
// assignment, never touches the database. This module runs
// server-side, AFTER the model has already decided to hand off, and
// deterministically matches the CUSTOMER'S OWN message text against
// the account's REAL, currently-configured departments/contacts
// (loaded via business-profile/service.ts, always scoped to the
// caller's own accountId — never anything the model could influence).
// It is pure string matching — no model call, no network — so running
// it only on the (comparatively rare) handoff path costs nothing on
// every other turn.
//
// LLM → [[HANDOFF]] → backend runs detectHandoffIntent() against real
// data → backend updates the conversation. The chain never runs in the
// other direction.
// ============================================================

import type { ContactRow, DepartmentRow } from './types'

export type HandoffIntentType = 'department' | 'contact' | 'general'

export interface HandoffIntentResult {
  type: HandoffIntentType
  department: DepartmentRow | null
  contact: ContactRow | null
  /** True when more than one real contact/department could plausibly
   *  match and nothing in the message disambiguated between them — the
   *  caller treats this exactly like 'general' (never guesses), but a
   *  human picking up the handoff benefits from knowing a name WAS
   *  mentioned, just not confidently resolved. */
  ambiguous: boolean
}

const GENERAL_RESULT: HandoffIntentResult = { type: 'general', department: null, contact: null, ambiguous: false }

function normalize(raw: string): string {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  s = s.replace(/[¿?¡!.,;:()"'“”]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack)
}

/** A contact matches when their full name appears verbatim, OR their
 *  first name (≥3 chars, to avoid over-matching very short names
 *  against common words) appears as its own word. "Carlos Pérez"
 *  matches both "hablar con Carlos" and "hablar con Carlos Pérez". */
function contactMatches(normalizedMessage: string, contact: ContactRow): boolean {
  const normalizedName = normalize(contact.name)
  if (containsWholeWord(normalizedMessage, normalizedName)) return true
  const firstName = normalizedName.split(' ')[0] ?? ''
  return firstName.length >= 3 && containsWholeWord(normalizedMessage, firstName)
}

function departmentMatches(normalizedMessage: string, department: DepartmentRow): boolean {
  return containsWholeWord(normalizedMessage, normalize(department.name))
}

/**
 * Deterministically classify what a handoff-triggering message asked
 * for, against THIS account's real, active departments/contacts.
 * Never invents a match: multiple equally-plausible candidates with no
 * disambiguating detail in the message resolve to 'general' with
 * `ambiguous: true`, exactly like having found nothing at all — a
 * human always ends up with the conversation either way, just with
 * (when available) a note about who was likely being asked for.
 */
export function detectHandoffIntent(
  message: string,
  departments: DepartmentRow[],
  contacts: ContactRow[],
): HandoffIntentResult {
  const normalized = normalize(message)
  if (!normalized) return GENERAL_RESULT

  const matchedContacts = contacts.filter((c) => contactMatches(normalized, c))
  const matchedDepartments = departments.filter((d) => departmentMatches(normalized, d))

  if (matchedContacts.length === 1) {
    const contact = matchedContacts[0]
    const department = contact.departmentId ? (departments.find((d) => d.id === contact.departmentId) ?? null) : null
    return { type: 'contact', contact, department, ambiguous: false }
  }

  if (matchedContacts.length > 1) {
    // "Carlos de ventas" — narrow by a department mentioned alongside
    // the name, per Parte 13. Never picks a department the message
    // didn't actually name just because it's the only one left.
    if (matchedDepartments.length === 1) {
      const narrowed = matchedContacts.filter((c) => c.departmentId === matchedDepartments[0].id)
      if (narrowed.length === 1) {
        return { type: 'contact', contact: narrowed[0], department: matchedDepartments[0], ambiguous: false }
      }
    }
    // Two+ people with the same name and nothing to tell them apart —
    // never guess (Parte 12: "Si el negocio tiene dos Carlos: NO
    // adivinar").
    return { type: 'general', department: null, contact: null, ambiguous: true }
  }

  if (matchedDepartments.length === 1) {
    return { type: 'department', department: matchedDepartments[0], contact: null, ambiguous: false }
  }
  if (matchedDepartments.length > 1) {
    return { type: 'general', department: null, contact: null, ambiguous: true }
  }

  return GENERAL_RESULT
}

/** Short, human-readable note for the internal handoff summary — never
 *  shown to the customer, only to the agent picking up the
 *  conversation. Deterministic, no LLM call. */
export function describeHandoffIntent(result: HandoffIntentResult): string | null {
  if (result.type === 'contact' && result.contact) {
    const dept = result.department ? ` (${result.department.name})` : ''
    return `Cliente solicitó hablar con ${result.contact.name}${dept}.`
  }
  if (result.type === 'department' && result.department) {
    return `Cliente solicitó el departamento de ${result.department.name}.`
  }
  if (result.ambiguous) {
    return 'Cliente mencionó un nombre/departamento que no se pudo identificar con certeza — verificar manualmente.'
  }
  return null
}
