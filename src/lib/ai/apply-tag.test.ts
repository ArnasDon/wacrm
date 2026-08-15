import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  addContactTagAndDispatch: vi.fn(),
}))

vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: h.addContactTagAndDispatch,
}))

import { applyAiTag } from './apply-tag'

function fakeDb(opts: { tag: { id: string; name: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'tags') {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: opts.tag, error: null }),
        }
        return { select: () => chain }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

const ARGS = {
  accountId: 'acct-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  tagId: 'tag-1',
}

beforeEach(() => {
  h.addContactTagAndDispatch.mockReset()
  h.addContactTagAndDispatch.mockResolvedValue({ added: true, dispatched: true })
})

describe('applyAiTag', () => {
  it('delegates the write + tag_added dispatch to addContactTagAndDispatch once the tag validates', async () => {
    const db = fakeDb({ tag: { id: 'tag-1', name: 'quer-consultor' } })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: true, tagName: 'quer-consultor' })
    expect(h.addContactTagAndDispatch).toHaveBeenCalledWith({
      db,
      accountId: 'acct-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
      context: { conversation_id: 'conv-1' },
    })
  })

  it('no-ops silently when the tag no longer validates (deleted/detoggled since prompt build)', async () => {
    const db = fakeDb({ tag: null })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: false, tagName: null })
    expect(h.addContactTagAndDispatch).not.toHaveBeenCalled()
  })

  it('no-ops without throwing when addContactTagAndDispatch fails to add', async () => {
    h.addContactTagAndDispatch.mockResolvedValue({ added: false, dispatched: false, reason: 'duplicate' })
    const db = fakeDb({ tag: { id: 'tag-1', name: 'quer-consultor' } })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: false, tagName: null })
  })
})
