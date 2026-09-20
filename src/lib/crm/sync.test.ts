import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncMetaAdLeadToCrm } from './sync'

const h = vi.hoisted(() => ({ createTwentyPerson: vi.fn() }))
vi.mock('./twenty-client', () => ({ createTwentyPerson: h.createTwentyPerson }))

interface FakeState {
  aiConfig: { crm_sync_enabled: boolean } | null
  conversation: { crm_person_id: string | null } | null
  contact: { name: string; phone: string } | null
  /** Captured payload of the crm_person_id claim UPDATE, if it ran. */
  claimedPersonId?: string
  /** false simulates losing the atomic claim race. */
  claimSucceeds: boolean
}

function fakeDb(state: FakeState): SupabaseClient {
  const db = {
    from: (table: string) => {
      if (table === 'ai_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.aiConfig, error: null }),
            }),
          }),
        }
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.contact, error: null }),
            }),
          }),
        }
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.conversation, error: null }),
            }),
          }),
          update: (payload: { crm_person_id: string }) => ({
            eq: () => ({
              is: () => ({
                select: () => {
                  state.claimedPersonId = payload.crm_person_id
                  return Promise.resolve({
                    data: state.claimSucceeds ? [{ id: 'conv-1' }] : [],
                    error: null,
                  })
                },
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
  }
  return db as unknown as SupabaseClient
}

const baseArgs = { accountId: 'acc-1', conversationId: 'conv-1', contactId: 'contact-1' }

beforeEach(() => {
  h.createTwentyPerson.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('syncMetaAdLeadToCrm', () => {
  it('creates a Twenty Person for a fresh meta_ad conversation and stores its id', async () => {
    h.createTwentyPerson.mockResolvedValue({ id: 'person-abc' })
    const state: FakeState = {
      aiConfig: { crm_sync_enabled: true },
      conversation: { crm_person_id: null },
      contact: { name: 'Maria Silva', phone: '351912345678' },
      claimSucceeds: true,
    }

    await syncMetaAdLeadToCrm({ db: fakeDb(state), ...baseArgs })

    expect(h.createTwentyPerson).toHaveBeenCalledWith({
      name: 'Maria Silva',
      phone: '351912345678',
    })
    expect(state.claimedPersonId).toBe('person-abc')
  })

  it('does nothing when crm_sync_enabled is off (default)', async () => {
    const state: FakeState = {
      aiConfig: { crm_sync_enabled: false },
      conversation: { crm_person_id: null },
      contact: { name: 'Maria Silva', phone: '351912345678' },
      claimSucceeds: true,
    }

    await syncMetaAdLeadToCrm({ db: fakeDb(state), ...baseArgs })

    expect(h.createTwentyPerson).not.toHaveBeenCalled()
  })

  it('does not duplicate when the conversation already has a crm_person_id', async () => {
    const state: FakeState = {
      aiConfig: { crm_sync_enabled: true },
      conversation: { crm_person_id: 'person-existing' },
      contact: { name: 'Maria Silva', phone: '351912345678' },
      claimSucceeds: true,
    }

    await syncMetaAdLeadToCrm({ db: fakeDb(state), ...baseArgs })

    expect(h.createTwentyPerson).not.toHaveBeenCalled()
  })

  it('never throws when Twenty is down/erroring — the caller (webhook) must be unaffected', async () => {
    h.createTwentyPerson.mockRejectedValue(new Error('ECONNREFUSED'))
    const state: FakeState = {
      aiConfig: { crm_sync_enabled: true },
      conversation: { crm_person_id: null },
      contact: { name: 'Maria Silva', phone: '351912345678' },
      claimSucceeds: true,
    }

    await expect(syncMetaAdLeadToCrm({ db: fakeDb(state), ...baseArgs })).resolves.toBeUndefined()
  })

  it('logs failures without leaking personal data (no name/phone in the log line)', async () => {
    h.createTwentyPerson.mockRejectedValue(new Error('ECONNREFUSED'))
    const errorSpy = vi.spyOn(console, 'error')
    const state: FakeState = {
      aiConfig: { crm_sync_enabled: true },
      conversation: { crm_person_id: null },
      contact: { name: 'Maria Silva', phone: '351912345678' },
      claimSucceeds: true,
    }

    await syncMetaAdLeadToCrm({ db: fakeDb(state), ...baseArgs })

    const loggedText = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(loggedText).not.toContain('Maria Silva')
    expect(loggedText).not.toContain('351912345678')
    expect(loggedText).toContain('acc-1')
  })
})
