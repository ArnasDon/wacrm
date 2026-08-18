import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimSingleSession, sessionChannelName, KICKED_EVENT } from './session-exclusivity'

function fakeQuery(result: { data: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  for (const method of ['select', 'eq']) {
    obj[method] = () => obj
  }
  obj.maybeSingle = () => Promise.resolve(result)
  return obj
}

describe('sessionChannelName', () => {
  it('is stable and namespaced per user id', () => {
    expect(sessionChannelName('abc-123')).toBe('user-session:abc-123')
  })
})

describe('claimSingleSession', () => {
  it('does nothing when the profile has no account_id', async () => {
    const signOut = vi.fn()
    const channel = vi.fn()
    const db = {
      from: vi.fn(() => fakeQuery({ data: null })),
      channel,
      auth: { signOut },
    } as unknown as SupabaseClient

    await claimSingleSession(db, 'user-1')

    expect(channel).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('skips broadcast and revocation when the account opted out', async () => {
    const signOut = vi.fn()
    const channel = vi.fn()
    const db = {
      from: vi.fn((table: string) =>
        table === 'profiles'
          ? fakeQuery({ data: { account_id: 'acct-1' } })
          : fakeQuery({ data: { enforce_single_session: false } }),
      ),
      channel,
      auth: { signOut },
    } as unknown as SupabaseClient

    await claimSingleSession(db, 'user-1')

    expect(channel).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('broadcasts a kicked event then revokes other sessions when enforced', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const send = vi.fn().mockResolvedValue({})
    const subscribe = vi.fn().mockResolvedValue(undefined)
    const removeChannel = vi.fn()
    const channel = vi.fn(() => ({ subscribe, send }))
    const db = {
      from: vi.fn((table: string) =>
        table === 'profiles'
          ? fakeQuery({ data: { account_id: 'acct-1' } })
          : fakeQuery({ data: { enforce_single_session: true } }),
      ),
      channel,
      removeChannel,
      auth: { signOut },
    } as unknown as SupabaseClient

    await claimSingleSession(db, 'user-1')

    expect(channel).toHaveBeenCalledWith(sessionChannelName('user-1'))
    expect(send).toHaveBeenCalledWith({ type: 'broadcast', event: KICKED_EVENT, payload: {} })
    expect(removeChannel).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('never throws even if a lookup rejects', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('network down')
      }),
      channel: vi.fn(),
      auth: { signOut: vi.fn() },
    } as unknown as SupabaseClient

    await expect(claimSingleSession(db, 'user-1')).resolves.toBeUndefined()
  })
})
