// ============================================================
// Minimal Twenty CRM REST client — write-only, one-way (EterWA →
// Twenty, never the reverse). Follows the same request shape already
// documented/tested for the Eter Growth Twenty instance — see
// /Users/ricardo/twenty-crm/API.md (`POST /rest/people`, FULL_NAME /
// PHONES composite field shapes).
//
// Credentials: `TWENTY_BASE_URL` + `TWENTY_API_KEY`, read from the
// process environment ONLY — same discipline as
// providers/claude-agent-sdk.ts's CLAUDE_CODE_OAUTH_TOKEN. Never in
// `ai_configs` (this is a service-wide integration, not a per-account
// key), never hardcoded, never logged.
// ============================================================

import { splitPhoneCallingCode } from '@/lib/whatsapp/phone-utils'

export class TwentyNotConfiguredError extends Error {
  constructor() {
    super('TWENTY_BASE_URL/TWENTY_API_KEY não estão definidas no ambiente do serviço.')
    this.name = 'TwentyNotConfiguredError'
  }
}

interface TwentyConfig {
  baseUrl: string
  apiKey: string
}

function getTwentyConfig(): TwentyConfig | null {
  const baseUrl = process.env.TWENTY_BASE_URL?.trim()
  const apiKey = process.env.TWENTY_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

/**
 * Splits a WhatsApp profile name into Twenty's FULL_NAME shape
 * (firstName/lastName). Twenty requires both sub-fields to be
 * non-empty strings for a usable display name — a single-word name
 * (the common case: "João", or just the phone number when WhatsApp
 * gave no profile name) goes entirely into `firstName`, with
 * `lastName` left as an empty string rather than omitted.
 */
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' }
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  }
}

interface CreatePersonArgs {
  name: string
  /** E.164-ish digits, as stored in `contacts.phone` (e.g.
   *  "351939000016"). Twenty's PHONES composite field REQUIRES the
   *  calling code and the national number as two separate sub-fields
   *  (`primaryPhoneCallingCode` / `primaryPhoneNumber`) — sending the
   *  whole thing as `primaryPhoneNumber` is rejected with
   *  INVALID_PHONE_NUMBER (see splitPhoneCallingCode below, which does
   *  the split). */
  phone: string
}

/**
 * Creates a Person in Twenty with just a name + phone (no company, no
 * email — WhatsApp never gives us those on the first message; see
 * syncMetaAdLeadToCrm's header for why we deliberately don't invent a
 * Company here). Throws on any failure (missing config, network error,
 * non-2xx) — the caller (syncMetaAdLeadToCrm) is the one responsible
 * for swallowing and logging, never this client.
 */
export async function createTwentyPerson(args: CreatePersonArgs): Promise<{ id: string }> {
  const config = getTwentyConfig()
  if (!config) throw new TwentyNotConfiguredError()

  const { firstName, lastName } = splitName(args.name)
  const { callingCode, nationalNumber } = splitPhoneCallingCode(args.phone)

  const res = await fetch(`${config.baseUrl}/rest/people`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: { firstName, lastName },
      phones: {
        primaryPhoneNumber: nationalNumber,
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: `+${callingCode}`,
        additionalPhones: [],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`Twenty createPerson falhou (HTTP ${res.status}): ${bodyText.slice(0, 300)}`)
  }

  const data = (await res.json().catch(() => null)) as { data?: { createPerson?: { id?: string } } } | null
  const id = data?.data?.createPerson?.id
  if (!id) {
    throw new Error('Twenty createPerson devolveu 2xx sem um id de registo utilizável.')
  }
  return { id }
}
