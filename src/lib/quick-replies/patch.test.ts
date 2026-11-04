import { describe, expect, it } from 'vitest'

import { resolveQuickReplyPatch, type StoredQuickReply } from './patch'

const validPayload = {
  kind: 'buttons',
  body: 'Pick one',
  buttons: [{ id: 'yes', title: 'Yes' }],
}

const textRow: StoredQuickReply = {
  kind: 'text',
  content_text: 'Hello there',
  interactive_payload: null,
}

const interactiveRow: StoredQuickReply = {
  kind: 'interactive',
  content_text: null,
  interactive_payload: validPayload,
}

describe('resolveQuickReplyPatch', () => {
  it('allows a title-only edit', () => {
    expect(resolveQuickReplyPatch({ title: ' New ' }, textRow)).toEqual({
      ok: true,
      update: { title: 'New' },
    })
  })

  it('rejects emptying the text of a text quick reply without a kind', () => {
    expect(resolveQuickReplyPatch({ content_text: '   ' }, textRow).ok).toBe(false)
    expect(resolveQuickReplyPatch({ content_text: null }, textRow).ok).toBe(false)
  })

  it('rejects a non-string content_text', () => {
    expect(resolveQuickReplyPatch({ content_text: 42 }, textRow).ok).toBe(false)
  })

  it('rejects clearing the payload of an interactive quick reply without a kind', () => {
    expect(
      resolveQuickReplyPatch({ interactive_payload: null }, interactiveRow).ok,
    ).toBe(false)
  })

  it('accepts a partial text edit on a text row', () => {
    expect(resolveQuickReplyPatch({ content_text: 'Updated' }, textRow)).toEqual({
      ok: true,
      update: { content_text: 'Updated' },
    })
  })

  it('switches kind and clears the other column', () => {
    expect(
      resolveQuickReplyPatch(
        { kind: 'interactive', interactive_payload: validPayload },
        textRow,
      ),
    ).toEqual({
      ok: true,
      update: {
        kind: 'interactive',
        interactive_payload: validPayload,
        content_text: null,
      },
    })
  })

  it('rejects switching to text without content', () => {
    expect(resolveQuickReplyPatch({ kind: 'text' }, interactiveRow).ok).toBe(false)
  })

  it('rejects an unknown kind and an empty title', () => {
    expect(resolveQuickReplyPatch({ kind: 'audio' }, textRow).ok).toBe(false)
    expect(resolveQuickReplyPatch({ title: '  ' }, textRow).ok).toBe(false)
  })

  it('does not re-validate a stale payload on a text row for a title edit', () => {
    const legacy = { ...textRow, interactive_payload: { junk: true } }
    expect(resolveQuickReplyPatch({ title: 'x' }, legacy).ok).toBe(true)
  })
})
