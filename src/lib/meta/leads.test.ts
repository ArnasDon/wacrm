import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => v),
}))

vi.mock('@/lib/crm/sync', () => ({
  syncMetaLeadToCrm: vi.fn().mockResolvedValue(undefined),
}))

const engineSendTemplateMock = vi.fn()
vi.mock('@/lib/automations/meta-send', () => ({
  engineSendTemplate: (...args: unknown[]) => engineSendTemplateMock(...args),
}))

const findExistingContactMock = vi.fn()
vi.mock('@/lib/contacts/dedupe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contacts/dedupe')>()
  return {
    ...actual,
    findExistingContact: (...args: unknown[]) => findExistingContactMock(...args),
  }
})

import {
  findConfigForPage,
  normalizeLeadFields,
  processLeadgenEvent,
  type WhatsappConfigForLead,
} from './leads'
import { pickPersonaTemplate } from './lead-templates'

// ------------------------------------------------------------
// Minimal in-memory Supabase stub. Chain shapes below mirror exactly
// what leads.ts calls (see its source) — anything unexpected throws
// so an accidental new query surfaces immediately instead of
// silently resolving to undefined.
// ------------------------------------------------------------
interface FakeResult {
  data: unknown
  error: { code?: string; message: string } | null
}

function chain(resolve: () => FakeResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    select: () => obj,
    maybeSingle: () => Promise.resolve(resolve()),
    single: () => Promise.resolve(resolve()),
    then: (onFulfilled: (v: FakeResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  }
  return obj
}

function makeFakeDb(opts: { leadgenSeen?: Set<string> } = {}) {
  const leadgenSeen = opts.leadgenSeen ?? new Set<string>()
  const metaLeadsUpdates: Record<string, unknown>[] = []
  let contactsInsert: Record<string, unknown> | null = null
  let conversationsInsert: Record<string, unknown> | null = null

  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table === 'meta_leads') {
            const leadgenId = row.leadgen_id as string
            if (leadgenSeen.has(leadgenId)) {
              return chain(() => ({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint' },
              }))
            }
            leadgenSeen.add(leadgenId)
            return chain(() => ({ data: { id: 'lead-1' }, error: null }))
          }
          if (table === 'contacts') {
            contactsInsert = row
            return chain(() => ({
              data: { id: 'contact-1', name: row.name, phone: row.phone },
              error: null,
            }))
          }
          if (table === 'conversations') {
            conversationsInsert = row
            return chain(() => ({ data: { id: 'conv-1' }, error: null }))
          }
          throw new Error(`unexpected insert on ${table}`)
        },
        update(patch: Record<string, unknown>) {
          if (table === 'meta_leads') metaLeadsUpdates.push(patch)
          return chain(() => ({ error: null }))
        },
        select() {
          if (table === 'conversations') {
            return chain(() => ({ data: [], error: null })) // no existing conversation
          }
          return chain(() => ({ data: null, error: null }))
        },
      }
    },
  }

  return {
    db: db as unknown as SupabaseClient,
    metaLeadsUpdates,
    get contactsInsert() {
      return contactsInsert
    },
    get conversationsInsert() {
      return conversationsInsert
    },
  }
}

const config: WhatsappConfigForLead = {
  id: 'config-1',
  account_id: 'account-1',
  user_id: 'user-1',
  phone_number_id: 'phone-1',
  waba_id: 'waba-1',
  access_token: 'encrypted-token',
}

function mockGraphResponse(fieldData: Array<{ name: string; values: string[] }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'leadgen-1',
        ad_id: 'ad-123',
        adset_id: 'adset-1',
        campaign_id: 'campaign-1',
        form_id: 'form-1',
        created_time: '1758700000',
        platform: 'fb',
        field_data: fieldData,
      }),
    }),
  )
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  findExistingContactMock.mockReset().mockResolvedValue(null)
  engineSendTemplateMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeLeadFields', () => {
  it('builds full name from first_name + last_name when full_name is absent', () => {
    const n = normalizeLeadFields([
      { name: 'first_name', values: ['Ricardo'] },
      { name: 'last_name', values: ['Silva'] },
    ])
    expect(n.fullName).toBe('Ricardo Silva')
  })

  it('normalizes phone to digits only', () => {
    const n = normalizeLeadFields([{ name: 'phone_number', values: ['+351 939 000 016'] }])
    expect(n.phone).toBe('351939000016')
  })

  it('reads consent as explicit false only when answered no', () => {
    const yes = normalizeLeadFields([{ name: 'consentimento_whatsapp', values: ['Sim'] }])
    const no = normalizeLeadFields([{ name: 'consentimento_whatsapp', values: ['Não'] }])
    const absent = normalizeLeadFields([])
    expect(yes.consent).toBe(true)
    expect(no.consent).toBe(false)
    expect(absent.consent).toBeNull()
  })

  it('returns null phone when the form has no phone field', () => {
    const n = normalizeLeadFields([{ name: 'email', values: ['a@b.com'] }])
    expect(n.phone).toBeNull()
  })
})

describe('pickPersonaTemplate', () => {
  it('falls back to the generic template for an unmapped ad_id', () => {
    expect(pickPersonaTemplate('ad-not-mapped').persona).toBe('generico')
  })
  it('falls back to the generic template when ad_id is missing', () => {
    expect(pickPersonaTemplate(null).persona).toBe('generico')
  })
})

describe('findConfigForPage', () => {
  it('returns null and logs when 2+ configs share a page_id', async () => {
    const rows = [
      { id: '1', account_id: 'a1' },
      { id: '2', account_id: 'a2' },
    ]
    const db = {
      from: () => ({
        select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    } as unknown as SupabaseClient
    const result = await findConfigForPage(db, 'page-1')
    expect(result).toBeNull()
  })

  it('returns null when no config matches', async () => {
    const db = {
      from: () => ({
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      }),
    } as unknown as SupabaseClient
    expect(await findConfigForPage(db, 'page-1')).toBeNull()
  })
})

describe('processLeadgenEvent', () => {
  it('is idempotent — a redelivered leadgen_id is processed once', async () => {
    mockGraphResponse([
      { name: 'full_name', values: ['Ricardo Silva'] },
      { name: 'phone_number', values: ['351939000016'] },
    ])
    engineSendTemplateMock.mockResolvedValue({ whatsapp_message_id: 'wamid.1' })

    const { db } = makeFakeDb()
    const change = { leadgen_id: 'leadgen-1', page_id: 'page-1', ad_id: 'ad-123' }

    const first = await processLeadgenEvent(db, config, change)
    const second = await processLeadgenEvent(db, config, change)

    expect(first.outcome).toBe('processed')
    expect(second.outcome).toBe('duplicate')
    expect(engineSendTemplateMock).toHaveBeenCalledTimes(1)
  })

  it('creates contact + conversation and marks template_status=sent on success', async () => {
    mockGraphResponse([
      { name: 'full_name', values: ['Ricardo Silva'] },
      { name: 'phone_number', values: ['351939000016'] },
      { name: 'company', values: ['Eter Growth'] },
    ])
    engineSendTemplateMock.mockResolvedValue({ whatsapp_message_id: 'wamid.1' })

    const fake = makeFakeDb()
    const result = await processLeadgenEvent(fake.db, config, {
      leadgen_id: 'leadgen-2',
      page_id: 'page-1',
      ad_id: 'ad-123',
    })

    expect(result.outcome).toBe('processed')
    expect(fake.contactsInsert).toMatchObject({ phone: '351939000016', name: 'Ricardo Silva' })
    expect(fake.conversationsInsert).toMatchObject({ source: 'meta_lead_ad', ad_id: 'ad-123' })
    const lastUpdate = fake.metaLeadsUpdates.at(-1)
    expect(lastUpdate).toMatchObject({ template_status: 'sent', template_message_id: 'wamid.1' })
    // First name only, per the {{1}} contract.
    expect(engineSendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ params: ['Ricardo'] }),
    )
  })

  it('marks template_pendente (never throws) when Meta rejects an unapproved template', async () => {
    mockGraphResponse([
      { name: 'full_name', values: ['Ricardo Silva'] },
      { name: 'phone_number', values: ['351939000016'] },
    ])
    engineSendTemplateMock.mockRejectedValue(
      new Error('Meta API error: 400 - (#132001) Template name does not exist in the translation'),
    )

    const fake = makeFakeDb()
    const result = await processLeadgenEvent(fake.db, config, {
      leadgen_id: 'leadgen-3',
      page_id: 'page-1',
    })

    expect(result.outcome).toBe('processed')
    const lastUpdate = fake.metaLeadsUpdates.at(-1)
    expect(lastUpdate).toMatchObject({ template_status: 'template_pendente' })
  })

  it('skips the template send and contact creation when consent is explicitly declined', async () => {
    mockGraphResponse([
      { name: 'full_name', values: ['Ricardo Silva'] },
      { name: 'phone_number', values: ['351939000016'] },
      { name: 'consentimento_whatsapp', values: ['Não'] },
    ])

    const fake = makeFakeDb()
    const result = await processLeadgenEvent(fake.db, config, {
      leadgen_id: 'leadgen-4',
      page_id: 'page-1',
    })

    expect(result.outcome).toBe('processed')
    expect(fake.contactsInsert).toBeNull()
    expect(engineSendTemplateMock).not.toHaveBeenCalled()
    const lastUpdate = fake.metaLeadsUpdates.at(-1)
    expect(lastUpdate).toMatchObject({ template_status: 'skipped_no_consent' })
  })

  it('skips the template send when the form yields no usable phone', async () => {
    mockGraphResponse([{ name: 'full_name', values: ['Ricardo Silva'] }])

    const fake = makeFakeDb()
    const result = await processLeadgenEvent(fake.db, config, {
      leadgen_id: 'leadgen-5',
      page_id: 'page-1',
    })

    expect(result.outcome).toBe('processed')
    expect(fake.contactsInsert).toBeNull()
    const lastUpdate = fake.metaLeadsUpdates.at(-1)
    expect(lastUpdate).toMatchObject({ template_status: 'skipped_no_phone' })
  })
})
