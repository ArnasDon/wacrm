import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  addContactTag: vi.fn(),
}))

vi.mock('@/lib/automations/engine', () => ({
  addContactTag: h.addContactTag,
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
  h.addContactTag.mockReset()
  h.addContactTag.mockResolvedValue({ added: true })
})

describe('applyAiTag', () => {
  it('delegates the write + tag_added dispatch to addContactTag once the tag validates', async () => {
    const db = fakeDb({ tag: { id: 'tag-1', name: 'quer-consultor' } })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: true, tagName: 'quer-consultor' })
    expect(h.addContactTag).toHaveBeenCalledWith({
      accountId: 'acct-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
      conversationId: 'conv-1',
    })
  })

  it('no-ops silently when the tag no longer validates (deleted/detoggled since prompt build)', async () => {
    const db = fakeDb({ tag: null })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: false, tagName: null })
    expect(h.addContactTag).not.toHaveBeenCalled()
  })

  it('no-ops without throwing when addContactTag fails to add', async () => {
    h.addContactTag.mockResolvedValue({ added: false })
    const db = fakeDb({ tag: { id: 'tag-1', name: 'quer-consultor' } })

    const result = await applyAiTag(db as never, ARGS)

    expect(result).toEqual({ applied: false, tagName: null })
  })
})
