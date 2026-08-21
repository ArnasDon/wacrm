import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadQuickReplyContext } from './quick-reply-context'

function makeDb(rows: { id: string; title: string; content_text: string }[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  const db = { from: () => chain }
  return db as unknown as SupabaseClient
}

describe('loadQuickReplyContext', () => {
  it('returns null when the account has no quick replies', async () => {
    const res = await loadQuickReplyContext(makeDb([]), 'acct-1')
    expect(res).toBeNull()
  })

  it('maps each row to id/title/preview', async () => {
    const res = await loadQuickReplyContext(
      makeDb([{ id: 'qr-1', title: 'Horario', content_text: 'Abrimos de 8am a 6pm.' }]),
      'acct-1',
    )
    expect(res).toEqual([{ id: 'qr-1', title: 'Horario', preview: 'Abrimos de 8am a 6pm.' }])
  })

  it('truncates a long snippet instead of blowing up the prompt', async () => {
    const long = 'x'.repeat(300)
    const res = await loadQuickReplyContext(
      makeDb([{ id: 'qr-1', title: 'Largo', content_text: long }]),
      'acct-1',
    )
    expect(res![0].preview.length).toBeLessThan(long.length)
    expect(res![0].preview).toContain('…')
  })

  it('filters out a row with empty content_text and returns null if that was the only one', async () => {
    const res = await loadQuickReplyContext(
      makeDb([{ id: 'qr-1', title: 'Vacío', content_text: '   ' }]),
      'acct-1',
    )
    expect(res).toBeNull()
  })
})
