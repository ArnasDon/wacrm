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

// ============================================================
// Bloco 5: Purchase (negócio ganho) → Meta Conversions API.
//
// getTwentyPerson / listWonOpportunitiesSince são leitura pura sobre a
// instância Twenty — mesma disciplina de createTwentyPerson: nunca
// engolem erro, o chamador (twenty-purchase.ts) é responsável por
// capturar e registar. Nunca logar email/telefone devolvidos.
// ============================================================

export interface TwentyPerson {
  id: string
  email: string | null
  phone: string | null
}

/** Busca uma Person pelo id, para o caminho `system_generated` (sem
 *  `ctwa_clid`) do Purchase — precisamos do email/telefone para os
 *  hashear em SHA-256 antes de enviar à Meta. Devolve `null` em vez
 *  de lançar quando o registo não existe (404), lança em qualquer
 *  outra falha. */
export async function getTwentyPerson(id: string): Promise<TwentyPerson | null> {
  const config = getTwentyConfig()
  if (!config) throw new TwentyNotConfiguredError()

  const res = await fetch(`${config.baseUrl}/rest/people/${id}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`Twenty getPerson falhou (HTTP ${res.status}): ${bodyText.slice(0, 300)}`)
  }

  const data = (await res.json().catch(() => null)) as {
    data?: { person?: { id?: string; emails?: { primaryEmail?: string }; phones?: { primaryPhoneCallingCode?: string; primaryPhoneNumber?: string } } }
  } | null
  const person = data?.data?.person
  if (!person?.id) return null

  const email = person.emails?.primaryEmail?.trim() || null
  const callingCode = person.phones?.primaryPhoneCallingCode?.replace(/\D/g, '') ?? ''
  const nationalNumber = person.phones?.primaryPhoneNumber?.replace(/\D/g, '') ?? ''
  const phone = callingCode && nationalNumber ? `${callingCode}${nationalNumber}` : null

  return { id: person.id, email, phone }
}

export interface TwentyWonOpportunity {
  id: string
  amountMicros: number
  currencyCode: string
  pointOfContactId: string | null
  updatedAt: string
}

/** Lista negócios na fase `CLIENTE` (ganho) actualizados desde `sinceIso`
 *  — usado pelo cron de reconciliação (fallback quando o webhook do
 *  Twenty falha ou não está configurado). Não pagina: o volume actual
 *  da instância (< 200 negócios) cabe sempre num pedido, ver API.md.
 *  Filtra só por `stage[eq]:CLIENTE` no pedido (sintaxe multi-condição
 *  com `updatedAt` não está confirmada em API.md) e aplica o corte por
 *  `updatedAt` em memória — seguro com o volume actual da instância. */
export async function listWonOpportunitiesSince(sinceIso: string): Promise<TwentyWonOpportunity[]> {
  const config = getTwentyConfig()
  if (!config) throw new TwentyNotConfiguredError()

  const filter = encodeURIComponent('stage[eq]:CLIENTE')
  const res = await fetch(`${config.baseUrl}/rest/opportunities?limit=200&filter=${filter}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`Twenty listOpportunities falhou (HTTP ${res.status}): ${bodyText.slice(0, 300)}`)
  }

  const data = (await res.json().catch(() => null)) as {
    data?: {
      opportunities?: Array<{
        id: string
        amount?: { amountMicros?: number; currencyCode?: string }
        pointOfContactId?: string | null
        updatedAt: string
      }>
    }
  } | null
  const opportunities = data?.data?.opportunities ?? []
  return opportunities
    .filter((o) => o.updatedAt >= sinceIso)
    .map((o) => ({
      id: o.id,
      amountMicros: o.amount?.amountMicros ?? 0,
      currencyCode: o.amount?.currencyCode ?? 'EUR',
      pointOfContactId: o.pointOfContactId ?? null,
      updatedAt: o.updatedAt,
    }))
}
